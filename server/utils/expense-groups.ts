// Broad groups for the burn breakdown on the Overview. Bookeeping.ai category names are either
// its own codes (SOFTWARE_SUBSCRIPTIONS, FLIGHTS) or names someone typed (Payroll), so they're
// matched by keyword, first match wins. Anything unmatched goes to "Other".
const EXPENSE_GROUP_RULES: { name: string; pattern: RegExp }[] = [
    { name: 'Wages & benefits', pattern: /payroll|wage|salar|benefit|pension|401k|retirement|health.?plan/ },
    { name: 'Taxes', pattern: /\btax(es|ation)?\b/ },
    { name: 'Insurance', pattern: /insurance/ },
    { name: 'Professional services', pattern: /professional|legal|lawyer|accounting|audit|consult|contractor/ },
    { name: 'Software & internet', pattern: /software|subscription|computer|internet|saas|hosting|electronics/ },
    { name: 'Rent & office', pattern: /\brent\b|utilit|office|postage|shipping|merchandise|supplies/ },
    { name: 'Travel', pattern: /flight|lodging|hotel|travel|transport|airfare|taxi|car.?rental/ },
    { name: 'Meals & events', pattern: /food|drink|meal|restaurant|coffee|entertainment|event|conference/ },
    { name: 'Bank fees', pattern: /bank.?fee|fee|interest|charge/ },
    // Kept apart so money sent out without a real category is easy to spot (and exclude in Settings → Cash).
    { name: 'Transfers out', pattern: /transfer/ },
]

/**
 * The broad expense group a bookkeeping category belongs to ("Wages & benefits", "Software & internet").
 *
 * @param input.categoryName - The transaction's category name, or null when uncategorized.
 * @param input.parentCategory - Its Bookeeping.ai parent category (TAX counts as taxes whatever the name).
 * @returns The group name.
 */
export function expenseGroupName({
    categoryName,
    parentCategory,
}: {
    categoryName: string | null
    parentCategory: string | null
}) {
    if (parentCategory === 'TAX' || parentCategory === 'TAX_PAYABLE') {
        return 'Taxes'
    }
    if (!categoryName) {
        return 'Uncategorized'
    }
    const words = categoryName.toLowerCase().replaceAll('_', ' ')
    return EXPENSE_GROUP_RULES.find(rule => rule.pattern.test(words))?.name ?? 'Other'
}
