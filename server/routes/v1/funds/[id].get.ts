import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { loadFundDetail } from '#server/utils/funds/fund-detail.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Get a fund',
        description:
            'The full profile: research findings with their sources, people and work history, due diligence answers (unanswered questions are the data gaps) and recent research runs.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The fund',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    return loadFundDetail({ fundManagerId: getRouterParam(event, 'id') ?? '' })
})
