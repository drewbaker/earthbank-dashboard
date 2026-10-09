import { defineRouteMeta } from 'nitropack/runtime'
import { listOpportunityRows } from '#server/database/opportunities.ts'
import { defineApiHandler, parseQuery } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeOpportunity } from '#server/utils/serializers/opportunities.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'
import { ListOpportunitiesQuery } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Opportunities'],
        summary: 'List opportunities',
        description:
            'Open opportunities by default, soonest expected receipt first. Pass include_closed for committed, received and lost.',
        parameters: [
            {
                name: 'goal_type',
                in: 'query',
                schema: { type: 'string', enum: ['design_grant', 'opex', 'lending_capital'] },
            },
            { name: 'stage', in: 'query', schema: { type: 'string' } },
            { name: 'funder_id', in: 'query', schema: { type: 'string' } },
            { name: 'owner_id', in: 'query', schema: { type: 'string' } },
            { name: 'include_closed', in: 'query', schema: { type: 'boolean' } },
            { name: 'include_archived', in: 'query', schema: { type: 'boolean' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } },
        ],
        responses: {
            200: {
                description: 'A page of opportunities',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/OpportunityList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const query = parseQuery({ event, schema: ListOpportunitiesQuery })
    const [rows, stageProbabilities] = await Promise.all([
        listOpportunityRows({
            goalType: query.goal_type,
            stage: query.stage,
            funderId: query.funder_id,
            ownerId: query.owner_id,
            includeClosed: query.include_closed,
            includeArchived: query.include_archived,
        }),
        readStageProbabilities(),
    ])
    const start = query.cursor ? rows.findIndex(row => row.id === query.cursor) + 1 : 0
    const page = rows.slice(start, start + query.limit)
    const hasMore = start + query.limit < rows.length
    return {
        data: page.map(opportunity => serializeOpportunity({ opportunity, stageProbabilities })),
        next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null,
        has_more: hasMore,
    }
})
