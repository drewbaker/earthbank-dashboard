// Covers the Bookeeping.ai integration: mapping double-entry payloads, retrying rate limits, and an
// idempotent sync into the database that feeds cash on hand and burn.
import { afterAll, describe, expect, it } from 'vitest'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'
import { BookeepingAiProvider } from '#server/utils/bookkeeping/bookeeping-ai.ts'

const { cleanupTestDatabase } = setupTestDatabase()

afterAll(async () => {
    await cleanupTestDatabase()
})

const ACCOUNTS = [
    { _id: 'acc_checking', accountName: 'Mercury Checking', accountNumber: '123456789', accountType: 'Depository' },
    { _id: 'acc_card', nickName: 'Amex', accountType: 'Credit' },
]

const BALANCES: Record<string, unknown> = {
    acc_checking: {
        institutionBalance: { currency: 'USD', endingBalance: 812_345.67 },
        accountingBalance: {
            currency: 'USD',
            endingBalance: 810_000,
            monthWiseBalance: [
                { month: '2026-08', endingBalance: 900_000 },
                { month: '2026-09', endingBalance: 850_000 },
                { month: '2026-10', endingBalance: 812_000 },
            ],
        },
    },
    acc_card: {
        institutionBalance: null,
        accountingBalance: { currency: 'USD', endingBalance: -4_000, monthWiseBalance: [] },
    },
}

const TRANSACTIONS = [
    {
        _id: 'txn_payroll',
        refNo: 'Gusto payroll',
        totalAmount: 42_000,
        transactionDate: '2026-09-15T00:00:00.000Z',
        account: { _id: 'acc_checking' },
        counterParty: { accountName: 'Gusto' },
        entries: [
            { amount: 42_000, type: 'DEBIT', isMain: true, parentCategory: 'EXPENSE', category: { name: 'Payroll' } },
            { amount: 42_000, type: 'CREDIT', isMain: false, parentCategory: 'CURRENT_ASSET' },
        ],
    },
    {
        _id: 'txn_grant',
        refNo: 'GA Foundation grant',
        totalAmount: 100_000,
        transactionDate: '2026-09-20',
        account: { _id: 'acc_checking' },
        entries: [
            { amount: 100_000, type: 'CREDIT', isMain: true, parentCategory: 'INCOME', category: { name: 'Grants' } },
            { amount: 100_000, type: 'DEBIT', isMain: false, parentCategory: 'CURRENT_ASSET' },
        ],
    },
]

/**
 * A fake fetch serving the payloads above, with one rate-limit response first.
 *
 * @returns The fetch function and the list of URLs it was called with.
 */
function fakeBookeepingApi() {
    const calls: string[] = []
    let hasRateLimited = false
    const fetchImpl = (async (input: URL | RequestInfo) => {
        const url = new URL(String(input))
        calls.push(url.pathname + url.search)
        if (!hasRateLimited) {
            hasRateLimited = true
            return new Response('slow down', { status: 429 })
        }
        const balanceMatch = url.pathname.match(/\/v1\/accounts\/([^/]+)\/balance$/)
        const data = url.pathname.endsWith('/v1/accounts')
            ? { accounts: ACCOUNTS }
            : balanceMatch
              ? BALANCES[balanceMatch[1]!]
              : { transactions: TRANSACTIONS, count: TRANSACTIONS.length }
        return Response.json({ message: 'ok', data })
    }) as typeof fetch
    return { fetchImpl, calls }
}

describe('Bookeeping.ai sync', () => {
    it('maps double-entry transactions to signed amounts with categories', async () => {
        const { toExternalTransaction } = await import('#server/utils/bookkeeping/bookeeping-ai.ts')
        expect(toExternalTransaction({ row: TRANSACTIONS[0] as never })).toMatchObject({
            amountCents: -4_200_000,
            categoryName: 'Payroll',
            parentCategory: 'EXPENSE',
            bookedOn: '2026-09-15',
        })
        expect(toExternalTransaction({ row: TRANSACTIONS[1] as never }).amountCents).toBe(10_000_000)
    })

    it('reads credit card spend, card payments and refunds the way Bookeeping.ai shapes them', async () => {
        const { describeEntryShapes, toExternalTransaction } =
            await import('#server/utils/bookkeeping/bookeeping-ai.ts')
        const base = { _id: 'tx', transactionDate: '2026-09-02T00:00:00.000Z', totalAmount: 1200 }
        const cardSpend = {
            ...base,
            entries: [
                {
                    amount: 1200,
                    type: 'DEBIT',
                    isMain: true,
                    parentCategory: 'EXPENSE',
                    category: { name: 'Software' },
                },
                { amount: 1200, type: 'CREDIT', isMain: false, parentCategory: 'CURRENT_LIABILITY' },
            ],
        }
        const cardPayment = {
            ...base,
            entries: [
                { amount: 1200, type: 'DEBIT', isMain: true, parentCategory: 'CURRENT_LIABILITY' },
                { amount: 1200, type: 'CREDIT', isMain: false, parentCategory: 'CURRENT_ASSET' },
            ],
        }
        const refund = {
            ...base,
            entries: [
                {
                    amount: 1200,
                    type: 'CREDIT',
                    isMain: true,
                    parentCategory: 'EXPENSE',
                    category: { name: 'Software' },
                },
                { amount: 1200, type: 'DEBIT', isMain: false, parentCategory: 'CURRENT_LIABILITY' },
            ],
        }
        const noFlag = {
            ...base,
            entries: [
                { amount: 1200, type: 'CREDIT', parentCategory: 'CURRENT_ASSET' },
                { amount: 1200, type: 'DEBIT', parentCategory: 'EXPENSE', category: { name: 'Rent' } },
            ],
        }
        expect(toExternalTransaction({ row: cardSpend as never })).toMatchObject({
            amountCents: -120_000,
            categoryName: 'Software',
            parentCategory: 'EXPENSE',
        })
        expect(toExternalTransaction({ row: cardPayment as never })).toMatchObject({
            amountCents: -120_000,
            parentCategory: 'CURRENT_LIABILITY',
        })
        expect(toExternalTransaction({ row: refund as never }).amountCents).toBe(120_000)
        expect(toExternalTransaction({ row: noFlag as never })).toMatchObject({
            amountCents: -120_000,
            categoryName: 'Rent',
        })
        expect(describeEntryShapes({ rows: [cardSpend, cardPayment] as never })).toEqual({
            'main:EXPENSE:DEBIT+other:CURRENT_LIABILITY:CREDIT': 1,
            'main:CURRENT_LIABILITY:DEBIT+other:CURRENT_ASSET:CREDIT': 1,
        })
    })

    it('syncs accounts, balances and transactions, and is safe to run twice', async () => {
        const { syncBookkeeping } = await import('#server/utils/bookkeeping/sync.ts')
        const { loadCashSummary } = await import('#server/utils/cash.ts')
        const { fetchImpl, calls } = fakeBookeepingApi()
        const provider = new BookeepingAiProvider({
            apiBase: 'https://api.test/public-api',
            apiKey: 'test',
            fetchImpl,
            wait: async () => {},
        })

        await syncBookkeeping({ provider, now: new Date('2026-10-09T12:00:00Z') })
        const second = await syncBookkeeping({ provider, now: new Date('2026-10-09T13:00:00Z') })
        expect(second.transactions).toBe(2)
        expect(calls[0]).toBe(calls[1])

        const summary = await loadCashSummary({ today: '2026-10-09' })
        // Only the checking account counts (the card is excluded by default); the bank's own balance wins.
        expect(summary).toMatchObject({
            balance_cents: 81_234_567,
            balance_as_of: '2026-10-09',
            balance_source: 'bookeeping',
        })
        expect(summary.accounts.map(account => [account.name, account.is_included])).toEqual([
            ['Amex', false],
            ['Mercury Checking ··6789', true],
        ])
        // Payroll counts toward burn; the grant doesn't. September is the only month with data.
        expect(summary.monthly_burn_cents).toBe(4_200_000)
        expect(summary.cash_history.map(point => point.date)).toEqual(['2026-08-31', '2026-09-30', '2026-10-09'])
        expect(summary.sync.last_error).toBeNull()
    })

    it('records the error when the provider fails', async () => {
        const { syncBookkeeping } = await import('#server/utils/bookkeeping/sync.ts')
        const { readSyncState } = await import('#server/utils/cash-settings.ts')
        const provider = new BookeepingAiProvider({
            apiBase: 'https://api.test/public-api',
            apiKey: 'bad',
            fetchImpl: (async () => new Response('nope', { status: 401 })) as typeof fetch,
            wait: async () => {},
        })
        await expect(syncBookkeeping({ provider, now: new Date('2026-10-09T14:00:00Z') })).rejects.toThrow(
            'failed with 401',
        )
        expect(await readSyncState()).toEqual({
            last_synced_at: '2026-10-09T13:00:00.000Z',
            last_error: 'Bookeeping.ai /v1/accounts failed with 401',
        })
    })

    it('counts credit card spend toward burn even though cards are not cash', async () => {
        const { upsertBankAccount, upsertBankTransaction } = await import('#server/database/bank.ts')
        const { loadCashSummary } = await import('#server/utils/cash.ts')
        const before = (await loadCashSummary({ today: '2026-10-09' })).monthly_burn_cents ?? 0
        const card = await upsertBankAccount({
            externalId: 'acc_card',
            name: 'Business card',
            accountType: 'Credit',
            currency: 'USD',
            syncedAt: new Date(),
        })
        expect(card.is_included).toBe(false)
        await upsertBankTransaction({
            externalId: 'txn_card_software',
            bankAccountId: card.id,
            bookedOn: new Date('2026-09-10T00:00:00Z'),
            amountCents: -900_000,
            description: null,
            counterpartyName: null,
            categoryName: 'Software',
            parentCategory: 'EXPENSE',
            sourceUpdatedAt: null,
        })
        const after = (await loadCashSummary({ today: '2026-10-09' })).monthly_burn_cents ?? 0
        expect(after).toBeGreaterThan(before)
    })
})
