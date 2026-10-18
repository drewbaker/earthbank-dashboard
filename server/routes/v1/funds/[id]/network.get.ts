import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { requireFund } from '#server/utils/funds/fund-detail.ts'
import { buildFundNetwork } from '#server/utils/funds/network.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: "A fund's team network",
        description:
            "Nodes and edges for the network graph: the fund, its people, where they worked or studied, and other funds' people at those same places.",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The network',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundNetwork' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const fund = await requireFund({ fundManagerId: getRouterParam(event, 'id') ?? '' })
    return buildFundNetwork({ fundManagerId: fund.id, fundName: fund.name })
})
