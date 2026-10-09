import {
    listBankAccountsWithLatestBalance,
    listBurnTransactions,
    listIncludedBalanceSnapshots,
} from '#server/database/bank.ts'
import { config } from '#server/utils/config.ts'
import { computeMonthlyBurn } from '#server/utils/burn.ts'
import { readCashSettings, readSyncState } from '#server/utils/cash-settings.ts'
import { centsToNumber, fromDateOnly, toDateOnly, toIsoDateTime } from '#server/utils/dates.ts'
import type { CashSummary } from '#shared/schemas/cash.ts'
import { addMonths, firstOfMonth } from '#shared/utils/calendar-dates.ts'

const CASH_HISTORY_MONTHS = 12

/**
 * Cash on hand, burn rate, recent history and account list: everything the Overview and Settings → Cash show.
 *
 * Cash comes from the newest synced balance of each included account, or the manual balance when
 * Bookeeping.ai isn't connected. Burn is the computed average unless a person set an override.
 *
 * @param input.today - Today's date (YYYY-MM-DD).
 * @returns The cash summary.
 */
export async function loadCashSummary({ today }: { today: string }): Promise<CashSummary> {
    const [settings, syncState, accounts] = await Promise.all([
        readCashSettings(),
        readSyncState(),
        listBankAccountsWithLatestBalance(),
    ])
    const includedWithBalance = accounts.filter(account => account.is_included && account.snapshots[0])
    const syncedBalance = includedWithBalance.reduce(
        (sum, account) => sum + Number(account.snapshots[0]!.balance_cents),
        0,
    )
    const syncedAsOf =
        includedWithBalance.map(account => toDateOnly({ date: account.snapshots[0]!.as_of })!).sort()[0] ?? null

    const balance =
        includedWithBalance.length > 0
            ? { cents: syncedBalance, asOf: syncedAsOf, source: 'bookeeping' as const }
            : settings.manual_balance_cents !== null
              ? { cents: settings.manual_balance_cents, asOf: settings.manual_balance_as_of, source: 'manual' as const }
              : { cents: null, asOf: null, source: 'none' as const }

    const lookbackStart = addMonths({ value: firstOfMonth({ value: today }), months: -settings.lookback_months })
    const transactions = await listBurnTransactions({
        from: fromDateOnly({ value: lookbackStart })!,
        to: fromDateOnly({ value: firstOfMonth({ value: today }) })!,
    })
    const burn = computeMonthlyBurn({
        transactions: transactions.map(transaction => ({
            bookedOn: toDateOnly({ date: transaction.booked_on })!,
            amountCents: Number(transaction.amount_cents),
            parentCategory: transaction.parent_category,
            categoryName: transaction.category_name,
            isExcluded: transaction.is_excluded_from_burn,
        })),
        today,
        lookbackMonths: settings.lookback_months,
        excludedCategories: settings.excluded_categories,
    })
    const monthlyBurn =
        settings.burn_override_cents !== null
            ? { cents: settings.burn_override_cents, source: 'override' as const }
            : burn.monthlyBurnCents !== null
              ? { cents: burn.monthlyBurnCents, source: 'computed' as const }
              : { cents: null, source: 'none' as const }

    return {
        balance_cents: balance.cents,
        balance_as_of: balance.asOf,
        balance_source: balance.source,
        monthly_burn_cents: monthlyBurn.cents,
        burn_source: monthlyBurn.source,
        computed_burn_cents: burn.monthlyBurnCents,
        burn_by_month: burn.months.map(month => ({ month: month.month, outflow_cents: month.outflowCents })),
        top_categories: burn.topCategories.map(category => ({
            name: category.name,
            monthly_cents: category.monthlyCents,
        })),
        cash_history: await loadCashHistory({ today }),
        accounts: accounts.map(account => ({
            id: account.id,
            name: account.name,
            account_type: account.account_type,
            is_included: account.is_included,
            balance_cents: centsToNumber({ cents: account.snapshots[0]?.balance_cents }),
            balance_as_of: toDateOnly({ date: account.snapshots[0]?.as_of }),
            last_synced_at: toIsoDateTime({ date: account.last_synced_at }),
        })),
        sync: {
            is_configured: Boolean(config.bookkeepingApiKey),
            last_synced_at: syncState.last_synced_at,
            last_error: syncState.last_error,
        },
    }
}

/**
 * Total cash of included accounts on each snapshot date over the last year.
 *
 * @param input.today - Today's date.
 * @returns Date → total balance, oldest first (only dates every included account reported).
 */
async function loadCashHistory({ today }: { today: string }) {
    const since = addMonths({ value: firstOfMonth({ value: today }), months: -CASH_HISTORY_MONTHS })
    const snapshots = await listIncludedBalanceSnapshots({ since: fromDateOnly({ value: since })! })
    const accountsPerDate = new Map<string, { total: number; accounts: number }>()
    for (const snapshot of snapshots) {
        const date = toDateOnly({ date: snapshot.as_of })!
        const entry = accountsPerDate.get(date) ?? { total: 0, accounts: 0 }
        accountsPerDate.set(date, { total: entry.total + Number(snapshot.balance_cents), accounts: entry.accounts + 1 })
    }
    const accountCount = Math.max(0, ...[...accountsPerDate.values()].map(entry => entry.accounts))
    return [...accountsPerDate.entries()]
        .filter(([, entry]) => entry.accounts === accountCount)
        .map(([date, entry]) => ({ date, balance_cents: entry.total }))
}
