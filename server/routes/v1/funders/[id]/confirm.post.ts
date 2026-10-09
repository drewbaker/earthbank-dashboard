import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findFunder } from '#server/database/funders.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { applyFieldChanges } from '#server/utils/change-events.ts'
import { badRequest, notFound } from '#server/utils/errors.ts'
import { loadFunderDetail } from '#server/utils/funders.ts'
import { enqueueFunderBackfill } from '#server/utils/jobs/enqueue.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funders'],
        summary: 'Confirm a drafted funder',
        description:
            'Adds an AI-drafted funder to the pipeline and reads the past year of email with them. To discard a draft, archive it.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The confirmed funder',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FunderDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const funderId = getRouterParam(event, 'id') ?? ''
    const funder = await findFunder({ funderId })
    if (!funder) {
        throw notFound({ resource: 'Funder' })
    }
    if (funder.status !== 'draft') {
        throw badRequest({ message: 'This funder is already confirmed.', code: 'funder_not_draft' })
    }
    await applyFieldChanges({
        entityType: 'funder',
        entityId: funderId,
        changes: { status: 'active' },
        source: 'manual',
        actorUserId: ctx.user.id,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'funder.confirmed',
        entityType: 'funder',
        entityId: funderId,
        ip: requestIp({ event }),
    })
    await enqueueFunderBackfill({ funderId })
    return loadFunderDetail({ funderId })
})
