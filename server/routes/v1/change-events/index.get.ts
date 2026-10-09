import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, parseQuery } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { listChangeEventFeed } from '#server/utils/change-event-feed.ts'
import { ListChangeEventsQuery } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Change log'],
        summary: 'List changes',
        description:
            'Every change to funders and opportunities, newest first. Filter by entity, funder (includes its opportunities), source or status.',
        parameters: [
            { name: 'entity_type', in: 'query', schema: { type: 'string', enum: ['funder', 'opportunity'] } },
            { name: 'entity_id', in: 'query', schema: { type: 'string' } },
            { name: 'funder_id', in: 'query', schema: { type: 'string' } },
            {
                name: 'source',
                in: 'query',
                schema: { type: 'string', enum: ['manual', 'import', 'ai_email', 'ai_forward'] },
            },
            {
                name: 'status',
                in: 'query',
                schema: { type: 'string', enum: ['applied', 'pending', 'rejected', 'reverted'] },
            },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
        ],
        responses: {
            200: {
                description: 'A page of changes',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ChangeEventList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const query = parseQuery({ event, schema: ListChangeEventsQuery })
    return listChangeEventFeed({
        entityType: query.entity_type,
        entityId: query.entity_id,
        funderId: query.funder_id,
        source: query.source,
        status: query.status,
        cursor: query.cursor,
        limit: query.limit,
    })
})
