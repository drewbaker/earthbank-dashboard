import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findFunderByNameKey } from '#server/database/funders.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { applyFieldChanges } from '#server/utils/change-events.ts'
import { conflict } from '#server/utils/errors.ts'
import { loadFunderDetail } from '#server/utils/funders.ts'
import { assertActiveUser } from '#server/utils/users.ts'
import { UpdateFunderRequest } from '#shared/schemas/index.ts'
import { funderNameKey } from '#shared/utils/funder-names.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funders'],
        summary: 'Update a funder',
        description: 'Every changed field is recorded in the change log as a manual edit.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateFunderRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated funder',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FunderDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const funderId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdateFunderRequest })
    if (body.name) {
        const sameName = await findFunderByNameKey({ nameKey: funderNameKey({ name: body.name }) })
        if (sameName && sameName.id !== funderId) {
            throw conflict({ message: `${sameName.name} is already in the pipeline.` })
        }
    }
    await assertActiveUser({ userId: body.owner_id })
    const events = await applyFieldChanges({
        entityType: 'funder',
        entityId: funderId,
        changes: body,
        source: 'manual',
        actorUserId: ctx.user.id,
    })
    if (events.length > 0) {
        await recordAudit({
            actor: ctx.actor,
            action: 'funder.updated',
            entityType: 'funder',
            entityId: funderId,
            changes: { fields: events.map(change => change.field) },
            ip: requestIp({ event }),
        })
    }
    return loadFunderDetail({ funderId })
})
