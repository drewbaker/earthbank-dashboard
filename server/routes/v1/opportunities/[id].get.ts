import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findOpportunity } from '#server/database/opportunities.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeOpportunity } from '#server/utils/serializers/opportunities.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Opportunities'],
        summary: 'Get an opportunity',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The opportunity',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Opportunity' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const opportunity = await findOpportunity({ opportunityId: getRouterParam(event, 'id') ?? '' })
    if (!opportunity) {
        throw notFound({ resource: 'Opportunity' })
    }
    return serializeOpportunity({ opportunity, stageProbabilities: await readStageProbabilities() })
})
