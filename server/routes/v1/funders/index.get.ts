import { defineRouteMeta } from 'nitropack/runtime'
import { listFunderSummaries } from '#server/database/funders.ts'
import { defineApiHandler, parseQuery } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeFunder } from '#server/utils/serializers/funders.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'
import { ListFundersQuery } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funders'],
        summary: 'List funders',
        description:
            'Funders with opportunity totals. Filter by tier, relationship status, goal, owner or search text.',
        parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'tier', in: 'query', schema: { type: 'string', enum: ['t1', 't2', 't3', 't4'] } },
            { name: 'relationship_status', in: 'query', schema: { type: 'string' } },
            {
                name: 'goal_type',
                in: 'query',
                schema: { type: 'string', enum: ['design_grant', 'opex', 'lending_capital'] },
            },
            { name: 'owner_id', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'draft'] } },
            { name: 'include_archived', in: 'query', schema: { type: 'boolean' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } },
        ],
        responses: {
            200: {
                description: 'A page of funders',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FunderList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const query = parseQuery({ event, schema: ListFundersQuery })
    const [funders, stageProbabilities] = await Promise.all([
        listFunderSummaries({
            search: query.q,
            tier: query.tier,
            relationshipStatus: query.relationship_status,
            goalType: query.goal_type,
            ownerId: query.owner_id,
            status: query.status,
            includeArchived: query.include_archived,
        }),
        readStageProbabilities(),
    ])
    return paginateByName({ items: funders.map(funder => serializeFunder({ funder, stageProbabilities })), ...query })
})

/**
 * Slice a name-ordered list into a page. The cursor is the last id of the previous page.
 *
 * Helper function: funders are ordered by name (not id), so the cursor is located by position.
 *
 * @param input.items - The full, ordered list.
 * @param input.cursor - Last id of the previous page.
 * @param input.limit - Page size.
 * @returns `{ data, next_cursor, has_more }`.
 */
function paginateByName<Item extends { id: string }>({
    items,
    cursor,
    limit,
}: {
    items: Item[]
    cursor?: string
    limit: number
}) {
    const start = cursor ? items.findIndex(item => item.id === cursor) + 1 : 0
    const data = items.slice(start, start + limit)
    const hasMore = start + limit < items.length
    return { data, next_cursor: hasMore ? (data.at(-1)?.id ?? null) : null, has_more: hasMore }
}
