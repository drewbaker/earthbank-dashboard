import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { archiveMilestone, findMilestone } from '#server/database/milestones.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Milestones'],
        summary: 'Delete a milestone',
        description: 'Archives the milestone. Its tasks are kept, without a milestone.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Deleted' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const milestoneId = getRouterParam(event, 'id') ?? ''
    const milestone = await findMilestone({ milestoneId })
    if (!milestone) {
        throw notFound({ resource: 'Milestone' })
    }
    await archiveMilestone({ milestoneId, archivedAt: new Date() })
    await recordAudit({
        actor: ctx.actor,
        action: 'milestone.deleted',
        entityType: 'milestone',
        entityId: milestoneId,
        changes: { title: milestone.title },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
