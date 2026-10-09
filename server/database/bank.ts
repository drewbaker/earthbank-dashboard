import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Create or update a synced bank account. New non-deposit accounts (cards, loans) start excluded
 * from cash on hand.
 *
 * @param input.externalId - Provider account id.
 * @param input.name - Display name.
 * @param input.accountType - Provider account type.
 * @param input.currency - Currency code.
 * @param input.syncedAt - When it was synced.
 * @returns The account row.
 */
export function upsertBankAccount({
    externalId,
    name,
    accountType,
    currency,
    syncedAt,
}: {
    externalId: string
    name: string
    accountType: string
    currency: string
    syncedAt: Date
}) {
    return db().bankAccount.upsert({
        where: { external_id: externalId },
        create: {
            id: newId({ kind: 'bankAccount' }),
            external_id: externalId,
            name,
            account_type: accountType,
            currency,
            is_included: accountType === 'Depository',
            last_synced_at: syncedAt,
        },
        update: { name, account_type: accountType, currency, last_synced_at: syncedAt },
    })
}

/**
 * Every synced bank account with its newest balance snapshot.
 *
 * @returns Accounts by name.
 */
export function listBankAccountsWithLatestBalance() {
    return db().bankAccount.findMany({
        include: { snapshots: { orderBy: { as_of: 'desc' }, take: 1 } },
        orderBy: { name: 'asc' },
    })
}

/**
 * Include or exclude an account from cash on hand.
 *
 * @param input.bankAccountId - The account.
 * @param input.isIncluded - Whether it counts.
 * @returns The updated account.
 */
export function setBankAccountIncluded({ bankAccountId, isIncluded }: { bankAccountId: string; isIncluded: boolean }) {
    return db().bankAccount.update({ where: { id: bankAccountId }, data: { is_included: isIncluded } })
}

/**
 * Record an account's balance on a date (replacing that date's earlier value).
 *
 * @param input.bankAccountId - The account.
 * @param input.asOf - The date (UTC midnight).
 * @param input.balanceCents - Balance.
 * @param input.source - `institution` or `accounting`.
 * @returns The snapshot row.
 */
export function upsertBalanceSnapshot({
    bankAccountId,
    asOf,
    balanceCents,
    source,
}: {
    bankAccountId: string
    asOf: Date
    balanceCents: number
    source: 'institution' | 'accounting'
}) {
    return db().balanceSnapshot.upsert({
        where: { bank_account_id_as_of: { bank_account_id: bankAccountId, as_of: asOf } },
        create: {
            id: newId({ kind: 'balanceSnapshot' }),
            bank_account_id: bankAccountId,
            as_of: asOf,
            balance_cents: BigInt(balanceCents),
            source,
        },
        update: { balance_cents: BigInt(balanceCents), source },
    })
}

/**
 * Month-end balances of included accounts, for the cash history chart.
 *
 * @param input.since - Earliest date.
 * @returns Snapshots with their account's inclusion flag.
 */
export function listIncludedBalanceSnapshots({ since }: { since: Date }) {
    return db().balanceSnapshot.findMany({
        where: { as_of: { gte: since }, bank_account: { is_included: true } },
        orderBy: { as_of: 'asc' },
    })
}

/**
 * Create or update a synced transaction (keeping a person's burn exclusion).
 *
 * @param input.externalId - Provider transaction id.
 * @param input.bankAccountId - Our account id, if the account is known.
 * @param input.bookedOn - Transaction date.
 * @param input.amountCents - Signed amount (+ in, − out).
 * @param input.description - Reference text.
 * @param input.counterpartyName - Who it was with.
 * @param input.categoryName - Bookkeeping category.
 * @param input.parentCategory - Bookkeeping parent category.
 * @param input.sourceUpdatedAt - Provider's last update time.
 * @returns The transaction row.
 */
export function upsertBankTransaction({
    externalId,
    bankAccountId,
    bookedOn,
    amountCents,
    description,
    counterpartyName,
    categoryName,
    parentCategory,
    sourceUpdatedAt,
}: {
    externalId: string
    bankAccountId: string | null
    bookedOn: Date
    amountCents: number
    description: string | null
    counterpartyName: string | null
    categoryName: string | null
    parentCategory: string | null
    sourceUpdatedAt: Date | null
}) {
    const fields = {
        bank_account_id: bankAccountId,
        booked_on: bookedOn,
        amount_cents: BigInt(amountCents),
        description,
        counterparty_name: counterpartyName,
        category_name: categoryName,
        parent_category: parentCategory,
        source_updated_at: sourceUpdatedAt,
    }
    return db().bankTransaction.upsert({
        where: { external_id: externalId },
        create: { id: newId({ kind: 'bankTransaction' }), external_id: externalId, ...fields },
        update: fields,
    })
}

/**
 * Transactions that count toward the burn rate in a date range: those of accounts counted as cash,
 * plus every credit card's. Cards aren't cash (their balance is owed), but they're where most
 * spending happens; paying a card off from checking is a transfer, so nothing is counted twice.
 *
 * @param input.from - First day (inclusive).
 * @param input.to - Last day (exclusive).
 * @returns Transactions oldest first.
 */
export function listBurnTransactions({ from, to }: { from: Date; to: Date }) {
    return db().bankTransaction.findMany({
        where: {
            booked_on: { gte: from, lt: to },
            OR: [
                { bank_account_id: null },
                { bank_account: { is_included: true } },
                { bank_account: { account_type: 'Credit' } },
            ],
        },
        orderBy: { booked_on: 'asc' },
    })
}

/**
 * Map provider account ids to ours.
 *
 * @returns External id → bank account id.
 */
export async function bankAccountIdsByExternalId() {
    const accounts = await db().bankAccount.findMany({ select: { id: true, external_id: true } })
    return new Map(accounts.map(account => [account.external_id, account.id]))
}
