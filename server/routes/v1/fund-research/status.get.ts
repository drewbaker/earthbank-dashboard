import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { readFundResearchStatus } from '#server/utils/funds/research-status.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Research assistant status',
        description:
            "Funds on the list against the limit, the research queue, and this month's spend against the budget.",
        responses: {
            200: {
                description: 'Status',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundResearchStatus' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    return readFundResearchStatus({ now: new Date() })
})
