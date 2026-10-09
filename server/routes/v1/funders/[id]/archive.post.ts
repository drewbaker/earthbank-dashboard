import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findFunder, setFunderArchivedAt } from '#server/database/funders.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { loadFunderDetail } from '#server/utils/funders.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funders'],
        summary: 'Archive a funder',
        description: 'Hides the funder and its opportunities from the pipeline and totals.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The funder',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FunderDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const funderId = getRouterParam(event, 'id') ?? ''
    if (!(await findFunder({ funderId }))) {
        throw notFound({ resource: 'Funder' })
    }
    await setFunderArchivedAt({ funderId, archivedAt: new Date() })
    await recordAudit({
        actor: ctx.actor,
        action: 'funder.archived',
        entityType: 'funder',
        entityId: funderId,
        ip: requestIp({ event }),
    })
    return loadFunderDetail({ funderId })
})
