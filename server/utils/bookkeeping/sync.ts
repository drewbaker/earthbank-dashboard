import {
    bankAccountIdsByExternalId,
    upsertBalanceSnapshot,
    upsertBankAccount,
    upsertBankTransaction,
} from '#server/database/bank.ts'
import type { BookkeepingProvider } from '#server/utils/bookkeeping/types.ts'
import { readSyncState, writeSyncState } from '#server/utils/cash-settings.ts'
import { fromDateOnly, toDateOnly } from '#server/utils/dates.ts'
import { addMonths, lastOfMonth } from '#shared/utils/calendar-dates.ts'

// Every sync re-reads the last year (enough history for burn and the cash chart), because
// transactions get re-categorized after the fact, often weeks later. Earth Bank has a few hundred
// transactions a year, so that's a couple of API reads an hour, far inside the rate limits.
const SYNC_MONTHS = 12
const MAX_TRANSACTION_PAGES = 40

export type BookkeepingSyncResult = { accounts: number; snapshots: number; transactions: number }

/**
 * Pull accounts, balances (today plus month-end history) and transactions into the database.
 * Idempotent: everything is upserted by the provider's ids, so a retried or overlapping run is safe.
 *
 * @param input.provider - Where bank data comes from.
 * @param input.now - Current time.
 * @returns Counts of what was written.
 * @throws Rethrows provider errors after recording them in the sync state.
 */
export async function syncBookkeeping({ provider, now }: { provider: BookkeepingProvider; now: Date }) {
    const previous = await readSyncState()
    try {
        const result = await pullBankData({ provider, now })
        await writeSyncState({ state: { last_synced_at: now.toISOString(), last_error: null } })
        console.info(`[bookkeeping] synced ${result.accounts} accounts, ${result.transactions} transactions`)
        return result
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await writeSyncState({ state: { last_synced_at: previous.last_synced_at, last_error: message } })
        console.error('[bookkeeping] sync failed', message)
        throw error
    }
}

/**
 * Fetch and store everything.
 *
 * @param input.provider - Where bank data comes from.
 * @param input.now - Current time.
 * @returns Counts of what was written.
 */
async function pullBankData({
    provider,
    now,
}: {
    provider: BookkeepingProvider
    now: Date
}): Promise<BookkeepingSyncResult> {
    const today = toDateOnly({ date: now })!
    let snapshots = 0
    const accounts = await provider.listAccounts()
    for (const account of accounts) {
        const row = await upsertBankAccount({ ...account, syncedAt: now })
        const balance = await provider.getAccountBalance({ accountId: account.externalId })
        const current = balance.institutionCents ?? balance.accountingCents
        if (current !== null) {
            await upsertBalanceSnapshot({
                bankAccountId: row.id,
                asOf: fromDateOnly({ value: today })!,
                balanceCents: current,
                source: balance.institutionCents !== null ? 'institution' : 'accounting',
            })
            snapshots++
        }
        for (const monthEnd of balance.monthEnds) {
            const asOf = lastOfMonth({ value: `${monthEnd.month}-01` })
            if (asOf < today) {
                await upsertBalanceSnapshot({
                    bankAccountId: row.id,
                    asOf: fromDateOnly({ value: asOf })!,
                    balanceCents: monthEnd.endingCents,
                    source: 'accounting',
                })
                snapshots++
            }
        }
    }

    const since = addMonths({ value: today, months: -SYNC_MONTHS })
    const accountIds = await bankAccountIdsByExternalId()
    let transactions = 0
    for (let page = 1; page <= MAX_TRANSACTION_PAGES; page++) {
        const result = await provider.listTransactions({ since, page })
        for (const transaction of result.transactions) {
            await upsertBankTransaction({
                externalId: transaction.externalId,
                bankAccountId: transaction.accountExternalId
                    ? (accountIds.get(transaction.accountExternalId) ?? null)
                    : null,
                bookedOn: fromDateOnly({ value: transaction.bookedOn })!,
                amountCents: transaction.amountCents,
                description: transaction.description,
                counterpartyName: transaction.counterpartyName,
                categoryName: transaction.categoryName,
                parentCategory: transaction.parentCategory,
                sourceUpdatedAt: transaction.updatedAt ? new Date(transaction.updatedAt) : null,
            })
            transactions++
        }
        if (!result.hasMore) {
            break
        }
    }
    return { accounts: accounts.length, snapshots, transactions }
}
