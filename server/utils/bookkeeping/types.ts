// Our own shapes for bank data, independent of any vendor's payloads.

export type ExternalBankAccount = { externalId: string; name: string; accountType: string; currency: string }

export type ExternalBalance = {
    /** The bank's own balance (when the account is linked through Plaid). */
    institutionCents: number | null
    /** The bookkeeping ledger's balance up to today. */
    accountingCents: number | null
    currency: string
    /** Ledger balance at the end of each month (YYYY-MM). */
    monthEnds: { month: string; endingCents: number }[]
}

export type ExternalTransaction = {
    externalId: string
    accountExternalId: string | null
    bookedOn: string
    /** Signed from the bank account's view: + money in, − money out. */
    amountCents: number
    description: string | null
    counterpartyName: string | null
    categoryName: string | null
    parentCategory: string | null
    updatedAt: string | null
}

export interface BookkeepingProvider {
    name: string
    listAccounts(): Promise<ExternalBankAccount[]>
    getAccountBalance(input: { accountId: string }): Promise<ExternalBalance>
    listTransactions(input: {
        since: string
        page: number
    }): Promise<{ transactions: ExternalTransaction[]; hasMore: boolean }>
}
