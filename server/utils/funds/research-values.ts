import type { FundResearchField } from '#shared/constants/funds.ts'
import type { TicketFit } from '#shared/constants/funds.ts'
import { EARTH_BANK_TICKET, WORKING_CAPITAL_LOAN_TYPES } from '#shared/constants/funds.ts'
import type { FundFindingValues, ResearchMoney } from '#shared/schemas/fund-findings.ts'
import { researchCompleteness } from '#shared/funds/completeness.ts'
import { toUsdCents } from '#shared/funds/money.ts'
import { partialDateStart } from '#server/utils/funds/verify-finding.ts'

/** An active finding, as far as the sort columns care. */
export type ActiveFinding = { field: FundResearchField; value: unknown; created_at: Date }

/** The fund's current research values, stored on fund_manager for sorting and filtering. */
export type FundResearchValues = {
    summary: string | null
    aum_cents: bigint | null
    latest_fund_size_cents: bigint | null
    last_fund_close_on: Date | null
    check_min_cents: bigint | null
    check_max_cents: bigint | null
    has_working_capital_loans: boolean
    max_working_capital_loan_cents: bigint | null
    year_established: number | null
    hq_country: string | null
    hq_city: string | null
    employee_count: number | null
    employee_range: string | null
    sectors: string[]
    loan_types: string[]
    focus_areas: string[]
    lender_archetype: string | null
    lending_channel: string | null
    lends_local_currency: boolean
    ticket_fit: TicketFit | null
    research_completeness: number
}

/**
 * Work out a fund's sortable research values from its active findings.
 *
 * Scalar fields use the newest finding. The largest working-capital loan comes from published
 * working-capital deals; when there are none but the fund lists working capital among its loan types,
 * the top of its check-size range stands in.
 *
 * @param input.findings - The fund's active findings.
 * @param input.hasPrincipals - Whether a principal is known.
 * @param input.hasWorkHistory - Whether any team work history is known.
 * @returns The values to store.
 */
export function deriveFundResearchValues({
    findings,
    hasPrincipals,
    hasWorkHistory,
}: {
    findings: ActiveFinding[]
    hasPrincipals: boolean
    hasWorkHistory: boolean
}): FundResearchValues {
    const newestFirst = [...findings].sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    const latest = <Field extends FundResearchField>(field: Field) =>
        newestFirst.find(finding => finding.field === field)?.value as FundFindingValues[Field] | undefined
    const all = <Field extends FundResearchField>(field: Field) =>
        newestFirst.filter(finding => finding.field === field).map(finding => finding.value as FundFindingValues[Field])

    const aum = latest('aum')
    const checkSize = latest('check_size')
    const headquarters = latest('headquarters')
    const loanTypes = latest('loan_types')?.types ?? []
    const fundRaises = all('fund_raise')
    const deals = all('deal')

    const closedRaises = fundRaises
        .filter(raise => raise.close_type === 'final_close' || raise.close_type === 'first_close')
        .map(raise => ({ raise, closedOn: partialDateStart({ text: raise.closed_on }) }))
        .filter((entry): entry is { raise: FundFindingValues['fund_raise']; closedOn: Date } => entry.closedOn !== null)
        .sort((a, b) => b.closedOn.getTime() - a.closedOn.getTime())
    const latestRaise = closedRaises[0]?.raise ?? fundRaises.find(raise => raise.size !== null)

    const workingCapitalDeals = deals.filter(
        deal => deal.loan_type !== null && WORKING_CAPITAL_LOAN_TYPES.includes(deal.loan_type),
    )
    const offersWorkingCapital = loanTypes.some(type => WORKING_CAPITAL_LOAN_TYPES.includes(type))
    const checkMaxCents = checkSize?.max ? toUsdCents({ amount: checkSize.max, currency: checkSize.currency }) : null
    const largestDealCents = maxCents({ amounts: workingCapitalDeals.map(deal => deal.amount) })

    const filledFields = new Set(findings.map(finding => finding.field))
    return {
        summary: latest('summary')?.text ?? null,
        aum_cents: toBigInt({ cents: aum ? toUsdCents(aum) : null }),
        latest_fund_size_cents: toBigInt({ cents: latestRaise?.size ? toUsdCents(latestRaise.size) : null }),
        last_fund_close_on: closedRaises[0]?.closedOn ?? null,
        check_min_cents: toBigInt({
            cents: checkSize?.min ? toUsdCents({ amount: checkSize.min, currency: checkSize.currency }) : null,
        }),
        check_max_cents: toBigInt({ cents: checkMaxCents }),
        has_working_capital_loans: offersWorkingCapital || workingCapitalDeals.length > 0,
        max_working_capital_loan_cents: toBigInt({
            cents: largestDealCents ?? (offersWorkingCapital ? checkMaxCents : null),
        }),
        year_established: latest('year_established')?.year ?? null,
        hq_country: headquarters?.country ?? null,
        hq_city: headquarters?.city ?? null,
        employee_count:
            latest('employee_count')?.count ?? lowerBound({ range: latest('employee_count')?.range ?? null }),
        employee_range: latest('employee_count')?.range ?? null,
        sectors: latest('sectors')?.sectors ?? [],
        loan_types: loanTypes,
        focus_areas: latest('geographic_focus')?.codes ?? [],
        lender_archetype: latest('lender_archetype')?.archetype ?? null,
        lending_channel: latest('lending_channel')?.channel ?? null,
        lends_local_currency: ['local', 'both'].includes(latest('lending_currency')?.basis ?? ''),
        ticket_fit: ticketFit({
            minCents: checkSize?.min ? toUsdCents({ amount: checkSize.min, currency: checkSize.currency }) : null,
            maxCents: checkMaxCents,
        }),
        research_completeness: researchCompleteness({ filledFields, hasPrincipals, hasWorkHistory }),
    }
}

/**
 * The largest of several amounts, in US cents.
 *
 * @param input.amounts - Amounts in their own currencies (null entries are skipped).
 * @returns The largest in cents, or null when none converts.
 */
function maxCents({ amounts }: { amounts: (ResearchMoney | null)[] }) {
    const cents = amounts
        .map(amount => (amount ? toUsdCents(amount) : null))
        .filter((value): value is number => value !== null)
    return cents.length > 0 ? Math.max(...cents) : null
}

/**
 * How a fund's check-size range compares with Earth Bank's $500K–$5M ticket.
 *
 * Measured on a log scale (a range from $500K to $1.6M covers as much as one from $1.6M to $5M):
 * `fits` when the fund's range covers at least half of ours (or a single ticket size falls inside it),
 * `partly` when it overlaps, `outside` when it doesn't.
 *
 * @param input.minCents - Smallest ticket in US cents, or null.
 * @param input.maxCents - Largest ticket in US cents, or null.
 * @returns The fit, or null when the check size isn't known.
 */
export function ticketFit({
    minCents,
    maxCents,
}: {
    minCents: number | null
    maxCents: number | null
}): TicketFit | null {
    const low = minCents ?? maxCents
    const high = maxCents ?? minCents
    if (low === null || high === null) {
        return null
    }
    const ourLow = EARTH_BANK_TICKET.minCents
    const ourHigh = EARTH_BANK_TICKET.maxCents
    if (high < ourLow || low > ourHigh) {
        return 'outside'
    }
    if (low === high) {
        return 'fits'
    }
    const covered = Math.log(Math.min(high, ourHigh)) - Math.log(Math.max(low, ourLow))
    return covered / (Math.log(ourHigh) - Math.log(ourLow)) >= 0.5 ? 'fits' : 'partly'
}

/**
 * The low end of a headcount band ("11-50" → 11, "1000+" → 1000), so bands sort with exact counts.
 *
 * @param input.range - The band, or null.
 * @returns The lower bound, or null.
 */
function lowerBound({ range }: { range: string | null }) {
    const match = /^(\d[\d,]*)/.exec(range ?? '')
    return match ? Number(match[1]!.replace(/,/g, '')) : null
}

/**
 * Cents as a BigInt column value.
 *
 * @param input.cents - Whole cents or null.
 * @returns The BigInt, or null.
 */
function toBigInt({ cents }: { cents: number | null }) {
    return cents === null ? null : BigInt(cents)
}
