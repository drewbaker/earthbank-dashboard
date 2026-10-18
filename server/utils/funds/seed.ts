import { countActiveFundManagers } from '#server/database/fund-managers.ts'
import { addFund } from '#server/utils/funds/add-fund.ts'

// The lenders the team asked to start from. Websites are left for the research to find (and verify)
// rather than typed in here.
export const SEED_FUND_NAMES = [
    'AHL Ventures',
    'Iungo Capital',
    'Enduring Planet',
    'Open Road Impact',
    'Spring Bank',
    'Clarmondial',
    'Arq Capital',
    'Prestamype',
] as const

// Region hints from the team's Airtable "Fund Manager Research" board, so the research can tell the
// right lender from others with similar names. Funds the board didn't list have no hint.
export const SEED_FUND_HINTS: Partial<Record<(typeof SEED_FUND_NAMES)[number], string>> = {
    'AHL Ventures': 'Listed on the board as AHL Venture Partners; Sub-Saharan Africa; working capital debt',
    'Iungo Capital': 'Sub-Saharan Africa',
    'Enduring Planet': 'United States',
    'Spring Bank': 'United States; Bronx, New York',
    Clarmondial: 'Multi-region / global; listed with its Food Securities Fund',
}

/**
 * Put the seed funds on the list and queue their research, the first time the app runs with fund research.
 *
 * @param input.now - Current time.
 * @returns How many seeds were added (0 once the list has anything on it).
 */
export async function ensureSeedFunds({ now }: { now: Date }) {
    if ((await countActiveFundManagers()) > 0) {
        return 0
    }
    let added = 0
    for (const name of SEED_FUND_NAMES) {
        const { isNew } = await addFund({
            name,
            websiteUrl: null,
            discoveryContext: SEED_FUND_HINTS[name] ?? null,
            origin: 'seed',
            now,
        })
        added += isNew ? 1 : 0
    }
    return added
}
