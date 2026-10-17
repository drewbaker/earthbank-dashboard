import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { listFundResearchRuns } from '#server/database/fund-research.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { requireFund } from '#server/utils/funds/fund-detail.ts'
import { serializeFundResearchRun } from '#server/utils/serializers/funds.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: "A fund's research runs",
        description:
            'Every research run on the fund, newest first, with searches, pages read, cost and findings kept or dropped.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'Runs',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundResearchRunList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const fund = await requireFund({ fundManagerId: getRouterParam(event, 'id') ?? '' })
    const runs = await listFundResearchRuns({ fundManagerId: fund.id, limit: 200 })
    return { data: runs.map(run => serializeFundResearchRun({ run })), next_cursor: null, has_more: false }
})
