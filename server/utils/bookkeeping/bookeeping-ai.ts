import { z } from 'zod'
import type {
    BookkeepingProvider,
    ExternalBalance,
    ExternalBankAccount,
    ExternalTransaction,
} from '#server/utils/bookkeeping/types.ts'

const PAGE_SIZE = 250
const MAX_ATTEMPTS = 5

// Only the fields we use are validated; everything else in Bookeeping.ai's payloads is ignored.
const AccountPayload = z.object({
    _id: z.string(),
    nickName: z.string().nullish(),
    accountName: z.string().nullish(),
    accountNumber: z.string().nullish(),
    accountType: z.string().nullish(),
})

const BalancePayload = z.object({
    institutionBalance: z.object({ currency: z.string().nullish(), endingBalance: z.number().nullish() }).nullish(),
    accountingBalance: z
        .object({
            currency: z.string().nullish(),
            endingBalance: z.number().nullish(),
            monthWiseBalance: z.array(z.object({ month: z.string(), endingBalance: z.number().nullish() })).nullish(),
        })
        .nullish(),
})

const EntryPayload = z.object({
    amount: z.number().nullish(),
    type: z.enum(['DEBIT', 'CREDIT']).nullish(),
    parentCategory: z.string().nullish(),
    category: z.object({ name: z.string().nullish(), parentCategory: z.string().nullish() }).nullish(),
    isMain: z.boolean().nullish(),
})

const TransactionPayload = z.object({
    _id: z.string(),
    refNo: z.string().nullish(),
    totalAmount: z.number().nullish(),
    transactionDate: z.string(),
    counterParty: z.object({ accountName: z.string().nullish() }).nullish(),
    account: z.object({ _id: z.string() }).nullish(),
    entries: z.array(EntryPayload).nullish(),
    updatedAt: z.string().nullish(),
})

/**
 * Reads accounts, balances and transactions from the Bookeeping.ai public API.
 * Rate limits: 100 reads/minute and 6,000/day; 429 responses are retried with backoff.
 */
export class BookeepingAiProvider implements BookkeepingProvider {
    readonly name = 'bookeeping.ai'
    private readonly apiBase: string
    private readonly apiKey: string
    private readonly fetchImpl: typeof fetch
    private readonly wait: (milliseconds: number) => Promise<void>

    /**
     * @param input.apiBase - Regional base URL, e.g. `https://api.bookeeping.ai/public-api`.
     * @param input.apiKey - API key from Settings → API Access.
     * @param input.fetchImpl - fetch to use (tests pass a fake).
     * @param input.wait - Delay function for backoff (tests pass a no-op).
     */
    constructor({
        apiBase,
        apiKey,
        fetchImpl = fetch,
        wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    }: {
        apiBase: string
        apiKey: string
        fetchImpl?: typeof fetch
        wait?: (milliseconds: number) => Promise<void>
    }) {
        this.apiBase = apiBase
        this.apiKey = apiKey
        this.fetchImpl = fetchImpl
        this.wait = wait
    }

    /**
     * Every account in the bookkeeping project.
     *
     * @returns Accounts.
     */
    async listAccounts(): Promise<ExternalBankAccount[]> {
        const accounts: ExternalBankAccount[] = []
        for (let page = 1; ; page++) {
            const data = await this.getJson({ path: '/v1/accounts', query: { page, limit: PAGE_SIZE } })
            const rows = z.array(AccountPayload).parse((data as { accounts?: unknown }).accounts ?? [])
            for (const row of rows) {
                const suffix = row.accountNumber ? ` ··${row.accountNumber.slice(-4)}` : ''
                accounts.push({
                    externalId: row._id,
                    name: `${row.nickName || row.accountName || 'Account'}${suffix}`,
                    accountType: row.accountType ?? 'Other',
                    currency: 'USD',
                })
            }
            if (rows.length < PAGE_SIZE) {
                return accounts
            }
        }
    }

    /**
     * One account's balance and month-end history.
     *
     * @param input.accountId - Bookeeping.ai account id.
     * @returns The balance.
     */
    async getAccountBalance({ accountId }: { accountId: string }): Promise<ExternalBalance> {
        const data = BalancePayload.parse(await this.getJson({ path: `/v1/accounts/${accountId}/balance`, query: {} }))
        const toCents = (dollars: number | null | undefined) =>
            typeof dollars === 'number' ? Math.round(dollars * 100) : null
        return {
            institutionCents: toCents(data.institutionBalance?.endingBalance),
            accountingCents: toCents(data.accountingBalance?.endingBalance),
            currency: data.institutionBalance?.currency ?? data.accountingBalance?.currency ?? 'USD',
            monthEnds: (data.accountingBalance?.monthWiseBalance ?? []).flatMap(month =>
                typeof month.endingBalance === 'number' && /^\d{4}-\d{2}$/.test(month.month)
                    ? [{ month: month.month, endingCents: Math.round(month.endingBalance * 100) }]
                    : [],
            ),
        }
    }

    /**
     * One page of transactions dated on or after `since`, oldest first.
     *
     * @param input.since - YYYY-MM-DD.
     * @param input.page - 1-based page number.
     * @returns The page and whether more pages exist.
     */
    async listTransactions({ since, page }: { since: string; page: number }) {
        const data = await this.getJson({
            path: '/v1/transactions',
            query: { page, limit: PAGE_SIZE, startDate: since, sortKey: 'transactionDate', sortOrder: 1 },
        })
        const rows = z.array(TransactionPayload).parse((data as { transactions?: unknown }).transactions ?? [])
        console.info(`[bookkeeping] transaction shapes (page ${page})`, JSON.stringify(describeEntryShapes({ rows })))
        return { transactions: rows.map(row => toExternalTransaction({ row })), hasMore: rows.length === PAGE_SIZE }
    }

    /**
     * GET a JSON endpoint and return its `data`, retrying rate limits and server errors with backoff.
     *
     * @param input.path - Path below the API base.
     * @param input.query - Query parameters.
     * @returns The response's `data` field.
     * @throws Error on a non-retryable error or when retries run out.
     */
    private async getJson({ path, query }: { path: string; query: Record<string, string | number> }) {
        const url = new URL(`${this.apiBase}${path}`)
        for (const [key, value] of Object.entries(query)) {
            url.searchParams.set(key, String(value))
        }
        for (let attempt = 1; ; attempt++) {
            const response = await this.fetchImpl(url, {
                headers: { authorization: `Bearer ${this.apiKey}`, accept: 'application/json' },
            })
            if (response.ok) {
                return ((await response.json()) as { data?: unknown }).data ?? {}
            }
            const isRetryable = response.status === 429 || response.status >= 500
            if (!isRetryable || attempt >= MAX_ATTEMPTS) {
                throw new Error(`Bookeeping.ai ${path} failed with ${response.status}`)
            }
            await this.wait(2 ** attempt * 1000)
        }
    }
}

/**
 * Map a Bookeeping.ai transaction to ours. Transactions are double-entry: one entry is the bank
 * account side (a DEBIT there means money came in) and the other carries the category. The bank side
 * is the entry marked `isMain`; when that flag is missing, it's the entry booked to a current asset
 * (bank accounts are current assets). Without a bank side, the sign comes from the category entry:
 * an expense is a DEBIT there, so a CREDIT means money came in.
 *
 * @param input.row - The validated payload.
 * @returns The transaction, signed from the bank account's view.
 */
export function toExternalTransaction({ row }: { row: z.infer<typeof TransactionPayload> }): ExternalTransaction {
    const entries = row.entries ?? []
    const bankEntry =
        entries.find(entry => entry.isMain) ??
        (entries.length > 1 ? entries.find(entry => entryParentCategory({ entry }) === BANK_PARENT_CATEGORY) : null) ??
        null
    const categoryEntry = entries.find(entry => entry !== bankEntry) ?? null
    const parentCategory = categoryEntry ? entryParentCategory({ entry: categoryEntry }) : null
    const amount = Math.abs(bankEntry?.amount ?? categoryEntry?.amount ?? row.totalAmount ?? 0)
    const isInflow = bankEntry
        ? bankEntry.type === 'DEBIT'
        : categoryEntry?.type
          ? categoryEntry.type === 'CREDIT'
          : INCOME_CATEGORIES.has(parentCategory ?? '')
    return {
        externalId: row._id,
        accountExternalId: row.account?._id ?? null,
        bookedOn: row.transactionDate.slice(0, 10),
        amountCents: Math.round(amount * 100) * (isInflow ? 1 : -1),
        description: row.refNo ?? null,
        counterpartyName: row.counterParty?.accountName ?? null,
        categoryName: categoryEntry?.category?.name ?? null,
        parentCategory,
        updatedAt: row.updatedAt ?? null,
    }
}

/**
 * Counts of how entries look (bank side or not, parent category, debit or credit), without amounts
 * or names, so the sync log shows how Bookeeping.ai shapes this account's data.
 *
 * @param input.rows - Validated transactions.
 * @returns Counts keyed like `main:CURRENT_ASSET:DEBIT`.
 */
export function describeEntryShapes({ rows }: { rows: z.infer<typeof TransactionPayload>[] }) {
    const shapes: Record<string, number> = {}
    for (const row of rows) {
        const entries = row.entries ?? []
        const key = entries.length
            ? entries
                  .map(
                      entry =>
                          `${entry.isMain ? 'main' : 'other'}:${entryParentCategory({ entry }) ?? 'none'}:${entry.type ?? '?'}`,
                  )
                  .sort()
                  .join('+')
            : 'no-entries'
        shapes[key] = (shapes[key] ?? 0) + 1
    }
    return shapes
}

/**
 * An entry's parent category, wherever Bookeeping.ai put it.
 *
 * @param input.entry - The entry.
 * @returns The parent category, or null.
 */
function entryParentCategory({ entry }: { entry: z.infer<typeof EntryPayload> }) {
    return entry.parentCategory ?? entry.category?.parentCategory ?? null
}

const BANK_PARENT_CATEGORY = 'CURRENT_ASSET'
const INCOME_CATEGORIES = new Set(['INCOME', 'OTHER_INCOME', 'SALES'])
