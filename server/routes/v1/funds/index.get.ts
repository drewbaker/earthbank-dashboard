import { defineRouteMeta } from 'nitropack/runtime'
import { listFundManagers } from '#server/database/fund-managers.ts'
import { defineApiHandler, parseQuery } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeFund } from '#server/utils/serializers/funds.ts'
import { WORKING_CAPITAL_TARGET_CENTS } from '#shared/constants/funds.ts'
import { ListFundsQuery } from '#shared/schemas/index.ts'
import { fromDateOnly } from '#server/utils/dates.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'List funds',
        description:
            'Lenders Earth Bank is considering, with their current research values. Money filters are whole US dollars; `working_capital=min_500k` keeps funds known to make working-capital loans of $500K or more.',
        parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'stage', in: 'query', schema: { type: 'string' } },
            { name: 'sector', in: 'query', schema: { type: 'string' } },
            { name: 'loan_type', in: 'query', schema: { type: 'string' } },
            { name: 'focus_area', in: 'query', schema: { type: 'string' } },
            { name: 'min_aum_usd', in: 'query', schema: { type: 'number' } },
            { name: 'max_aum_usd', in: 'query', schema: { type: 'number' } },
            { name: 'min_fund_size_usd', in: 'query', schema: { type: 'number' } },
            { name: 'closed_since', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'check_size_min_usd', in: 'query', schema: { type: 'number' } },
            { name: 'check_size_max_usd', in: 'query', schema: { type: 'number' } },
            { name: 'working_capital', in: 'query', schema: { type: 'string', enum: ['any', 'min_500k'] } },
            { name: 'min_completeness', in: 'query', schema: { type: 'integer' } },
            { name: 'lender_archetype', in: 'query', schema: { type: 'string' } },
            {
                name: 'lending_channel',
                in: 'query',
                schema: { type: 'string', enum: ['direct', 'on_lending', 'both'] },
            },
            { name: 'local_currency', in: 'query', schema: { type: 'boolean' } },
            { name: 'ticket_fit', in: 'query', schema: { type: 'string', enum: ['fits', 'partly', 'outside'] } },
            { name: 'research_status', in: 'query', schema: { type: 'string' } },
            { name: 'origin', in: 'query', schema: { type: 'string' } },
            {
                name: 'approval_status',
                in: 'query',
                description: 'Pending funds were found by the spider and wait for someone to approve them.',
                schema: { type: 'string', enum: ['pending', 'approved'] },
            },
            { name: 'include_archived', in: 'query', schema: { type: 'boolean' } },
            {
                name: 'archived',
                in: 'query',
                description: 'Only archived funds (by the team, or screened out by the AI).',
                schema: { type: 'boolean' },
            },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 1000 } },
        ],
        responses: {
            200: {
                description: 'Funds',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const query = parseQuery({ event, schema: ListFundsQuery })
    const funds = await listFundManagers({
        search: query.q,
        stage: query.stage,
        sector: query.sector,
        loanType: query.loan_type,
        focusArea: query.focus_area,
        minAumCents: dollarsToCents({ dollars: query.min_aum_usd }),
        maxAumCents: dollarsToCents({ dollars: query.max_aum_usd }),
        minFundSizeCents: dollarsToCents({ dollars: query.min_fund_size_usd }),
        closedSince: fromDateOnly({ value: query.closed_since }) ?? undefined,
        checkSizeMinCents: dollarsToCents({ dollars: query.check_size_min_usd }),
        checkSizeMaxCents: dollarsToCents({ dollars: query.check_size_max_usd }),
        requireWorkingCapital: query.working_capital !== undefined,
        minWorkingCapitalCents: query.working_capital === 'min_500k' ? BigInt(WORKING_CAPITAL_TARGET_CENTS) : undefined,
        minCompleteness: query.min_completeness,
        lenderArchetype: query.lender_archetype,
        lendingChannel: query.lending_channel,
        requireLocalCurrency: query.local_currency,
        ticketFit: query.ticket_fit,
        researchStatus: query.research_status,
        origin: query.origin,
        approvalStatus: query.approval_status,
        includeArchived: query.include_archived,
        archivedOnly: query.archived,
        limit: query.limit,
    })
    // The whole list (at most 1,000) fits in one response, so there is never a next page.
    return { data: funds.map(fund => serializeFund({ fund })), next_cursor: null, has_more: false }
})

/**
 * Whole dollars from a query string as BigInt cents.
 *
 * @param input.dollars - Dollars, or undefined when the filter isn't set.
 * @returns Cents, or undefined.
 */
function dollarsToCents({ dollars }: { dollars: number | undefined }) {
    return dollars === undefined ? undefined : BigInt(Math.round(dollars * 100))
}
