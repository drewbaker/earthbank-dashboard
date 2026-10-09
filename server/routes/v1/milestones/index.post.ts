import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { createMilestoneRow } from '#server/database/milestones.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { fromDateOnly } from '#server/utils/dates.ts'
import { resolveMilestoneLinks } from '#server/utils/milestones.ts'
import { serializeMilestone } from '#server/utils/serializers/milestones.ts'
import { requestToday } from '#server/utils/time-zone.ts'
import { CreateMilestoneRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Milestones'],
        summary: 'Create a milestone',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateMilestoneRequest' } } },
        },
        responses: {
            201: {
                description: 'Milestone created',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Milestone' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: CreateMilestoneRequest })
    const links = await resolveMilestoneLinks({
        goalType: body.goal_type ?? null,
        opportunityId: body.opportunity_id ?? null,
    })
    const milestone = await createMilestoneRow({
        title: body.title,
        description: body.description ?? null,
        dueAt: fromDateOnly({ value: body.due_at })!,
        kind: body.kind,
        ...links,
        createdById: ctx.user.id,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'milestone.created',
        entityType: 'milestone',
        entityId: milestone.id,
        changes: { title: body.title, due_at: body.due_at },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializeMilestone({ milestone, today: requestToday({ event }) })
})
