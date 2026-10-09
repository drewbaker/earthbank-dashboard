import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findChangeEvent } from '#server/database/change-events.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeChangeEvent } from '#server/utils/change-event-feed.ts'
import { acceptChangeEvent } from '#server/utils/change-events.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Change log'],
        summary: 'Accept a pending change',
        description: 'Writes the suggested value to the funder or opportunity.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The change',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ChangeEvent' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const changeEventId = getRouterParam(event, 'id') ?? ''
    await acceptChangeEvent({ changeEventId, actorUserId: ctx.user.id })
    await recordAudit({
        actor: ctx.actor,
        action: 'change.accepted',
        entityType: 'change_event',
        entityId: changeEventId,
        ip: requestIp({ event }),
    })
    const changeEvent = await findChangeEvent({ changeEventId })
    return serializeChangeEvent({ event: changeEvent! })
})
