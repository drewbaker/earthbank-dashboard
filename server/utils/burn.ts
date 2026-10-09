import { addMonths, firstOfMonth } from '#shared/utils/calendar-dates.ts'

// Bookkeeping parent categories that are operating spend. Transfers between our own accounts,
// loans, equity and asset purchases move money without being "burn", so they're left out.
const OPERATING_CATEGORIES = new Set([
    'EXPENSE',
    'COST_OF_GOODS_SOLD',
    'OTHER_EXPENSE',
    'OVERHEAD',
    'TAX',
    'TAX_PAYABLE',
])

export type BurnTransaction = {
    bookedOn: string
    amountCents: number
    parentCategory: string | null
    categoryName: string | null
    isExcluded: boolean
}

export type BurnResult = {
    monthlyBurnCents: number | null
    months: { month: string; outflowCents: number }[]
    topCategories: { name: string; monthlyCents: number }[]
}

/**
 * Average monthly operating spend over the last full months.
 *
 * Counts money out in operating categories (and uncategorized money out, to stay conservative),
 * minus refunds into those categories. The current, partial month is never included.
 *
 * @param input.transactions - Transactions of included accounts, any range.
 * @param input.today - Today's date (YYYY-MM-DD).
 * @param input.lookbackMonths - How many full months to average.
 * @param input.excludedCategories - Category names a person has left out.
 * @returns The average, the per-month totals and the biggest categories.
 */
export function computeMonthlyBurn({
    transactions,
    today,
    lookbackMonths,
    excludedCategories,
}: {
    transactions: BurnTransaction[]
    today: string
    lookbackMonths: number
    excludedCategories: string[]
}): BurnResult {
    const thisMonth = firstOfMonth({ value: today })
    const months = Array.from({ length: lookbackMonths }, (_, index) =>
        addMonths({ value: thisMonth, months: index - lookbackMonths }).slice(0, 7),
    )
    const excluded = new Set(excludedCategories.map(name => name.toLowerCase()))
    const outflowByMonth = new Map(months.map(month => [month, 0]))
    const outflowByCategory = new Map<string, number>()

    for (const transaction of transactions) {
        const month = transaction.bookedOn.slice(0, 7)
        if (!outflowByMonth.has(month) || !countsTowardBurn({ transaction, excluded })) {
            continue
        }
        outflowByMonth.set(month, outflowByMonth.get(month)! - transaction.amountCents)
        const category = transaction.categoryName ?? 'Uncategorized'
        outflowByCategory.set(category, (outflowByCategory.get(category) ?? 0) - transaction.amountCents)
    }

    const monthsWithData = new Set(transactions.map(transaction => transaction.bookedOn.slice(0, 7)))
    const countedMonths = months.filter(month => monthsWithData.has(month))
    const total = countedMonths.reduce((sum, month) => sum + outflowByMonth.get(month)!, 0)
    return {
        monthlyBurnCents: countedMonths.length > 0 ? Math.max(0, Math.round(total / countedMonths.length)) : null,
        months: months.map(month => ({ month, outflowCents: Math.round(outflowByMonth.get(month)!) })),
        topCategories: [...outflowByCategory.entries()]
            .map(([name, cents]) => ({ name, monthlyCents: Math.round(cents / Math.max(1, countedMonths.length)) }))
            .filter(category => category.monthlyCents > 0)
            .sort((first, second) => second.monthlyCents - first.monthlyCents)
            .slice(0, 8),
    }
}

/**
 * Whether a transaction is operating spend (or a refund of it).
 *
 * @param input.transaction - The transaction.
 * @param input.excluded - Lowercased category names left out by a person.
 * @returns True when it counts toward burn.
 */
function countsTowardBurn({ transaction, excluded }: { transaction: BurnTransaction; excluded: Set<string> }) {
    if (transaction.isExcluded || excluded.has((transaction.categoryName ?? '').toLowerCase())) {
        return false
    }
    if (transaction.parentCategory === null) {
        // Uncategorized money out counts (conservative); uncategorized money in is not assumed to be a refund.
        return transaction.amountCents < 0
    }
    return OPERATING_CATEGORIES.has(transaction.parentCategory)
}
