import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findMilestone, updateMilestoneRow } from '#server/database/milestones.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { fromDateOnly } from '#server/utils/dates.ts'
import { notFound } from '#server/utils/errors.ts'
import { resolveMilestoneLinks } from '#server/utils/milestones.ts'
import { serializeMilestone } from '#server/utils/serializers/milestones.ts'
import { requestToday } from '#server/utils/time-zone.ts'
import { UpdateMilestoneRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Milestones'],
        summary: 'Update a milestone',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateMilestoneRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated milestone',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Milestone' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const milestoneId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdateMilestoneRequest })
    const existing = await findMilestone({ milestoneId })
    if (!existing) {
        throw notFound({ resource: 'Milestone' })
    }
    const isRelinking = body.goal_type !== undefined || body.opportunity_id !== undefined
    const links = isRelinking
        ? await resolveMilestoneLinks({
              goalType: body.goal_type === undefined ? ((existing.goal?.type as never) ?? null) : body.goal_type,
              opportunityId: body.opportunity_id === undefined ? existing.opportunity_id : body.opportunity_id,
          })
        : null
    const milestone = await updateMilestoneRow({
        milestoneId,
        data: {
            title: body.title,
            description: body.description,
            due_at: body.due_at ? fromDateOnly({ value: body.due_at })! : undefined,
            kind: body.kind,
            status: body.status,
            ...(links ? { goal_id: links.goalId, opportunity_id: links.opportunityId, funder_id: links.funderId } : {}),
        },
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'milestone.updated',
        entityType: 'milestone',
        entityId: milestoneId,
        changes: body,
        ip: requestIp({ event }),
    })
    return serializeMilestone({ milestone, today: requestToday({ event }) })
})
