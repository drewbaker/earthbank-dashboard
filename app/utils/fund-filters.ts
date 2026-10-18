import type { LocationQuery } from 'vue-router'
import type { FundSector, FundStage, LoanType } from '#shared/constants/funds.ts'

// The Funds list filters. They live in the URL so a filtered view can be shared or bookmarked.
export type FundFilters = {
    q: string
    stage: FundStage | 'all'
    sector: FundSector | 'all'
    loan_type: LoanType | 'all'
    focus_area: string
    min_aum_usd: string
    min_fund_size_usd: string
    closed_within_years: string
    check_size_usd: string
    working_capital: 'all' | 'any' | 'min_500k'
    min_completeness: string
    ticket_fit: string
    lender_archetype: string
    lending_channel: string
    local_currency: string
}

// Select options can't be empty strings; "no filter" is this sentinel.
export const ANY_FILTER = 'all'

export const EMPTY_FUND_FILTERS: FundFilters = {
    q: '',
    stage: 'all',
    sector: 'all',
    loan_type: 'all',
    focus_area: ANY_FILTER,
    min_aum_usd: ANY_FILTER,
    min_fund_size_usd: ANY_FILTER,
    closed_within_years: ANY_FILTER,
    check_size_usd: ANY_FILTER,
    working_capital: 'all',
    min_completeness: ANY_FILTER,
    ticket_fit: ANY_FILTER,
    lender_archetype: ANY_FILTER,
    lending_channel: ANY_FILTER,
    local_currency: ANY_FILTER,
}

/**
 * Read filters from the URL query.
 *
 * @param input.query - The route query.
 * @returns Filters (unset ones at their defaults).
 */
export function fundFiltersFromQuery({ query }: { query: LocationQuery }): FundFilters {
    const filters = { ...EMPTY_FUND_FILTERS }
    for (const key of Object.keys(filters) as (keyof FundFilters)[]) {
        const value = query[key]
        if (typeof value === 'string' && value) {
            ;(filters as Record<string, string>)[key] = value
        }
    }
    return filters
}

/**
 * Filters as a URL query, leaving defaults out.
 *
 * @param input.filters - The filters.
 * @returns Query entries.
 */
export function fundFiltersToQuery({ filters }: { filters: FundFilters }) {
    return Object.fromEntries(
        Object.entries(filters).filter(
            ([key, value]) => value !== EMPTY_FUND_FILTERS[key as keyof FundFilters] && value !== '',
        ),
    )
}

/**
 * Filters as API query parameters for GET /v1/funds.
 *
 * "Makes a loan of X" becomes a check-size range covering X; "closed within N years" becomes a date.
 *
 * @param input.filters - The filters.
 * @param input.today - Today's date (YYYY-MM-DD), for "closed within".
 * @returns Query parameters.
 */
export function fundFiltersToApiQuery({ filters, today }: { filters: FundFilters; today: string }) {
    const set = (value: string) => (value && value !== ANY_FILTER ? value : undefined)
    const closedSince = set(filters.closed_within_years)
        ? `${Number(today.slice(0, 4)) - Number(filters.closed_within_years)}${today.slice(4)}`
        : undefined
    return {
        q: filters.q.trim() || undefined,
        stage: set(filters.stage),
        sector: set(filters.sector),
        loan_type: set(filters.loan_type),
        focus_area: set(filters.focus_area),
        min_aum_usd: set(filters.min_aum_usd),
        min_fund_size_usd: set(filters.min_fund_size_usd),
        closed_since: closedSince,
        check_size_min_usd: set(filters.check_size_usd),
        check_size_max_usd: set(filters.check_size_usd),
        working_capital: set(filters.working_capital),
        min_completeness: set(filters.min_completeness),
        ticket_fit: set(filters.ticket_fit),
        lender_archetype: set(filters.lender_archetype),
        lending_channel: set(filters.lending_channel),
        local_currency: filters.local_currency === 'yes' ? true : undefined,
    }
}

/**
 * How many filters are set (for the "Clear filters" button).
 *
 * @param input.filters - The filters.
 * @returns The count.
 */
export function activeFundFilterCount({ filters }: { filters: FundFilters }) {
    return Object.keys(fundFiltersToQuery({ filters })).length
}
