import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { goalIdsByType } from '#server/database/goals.ts'
import { findOpportunity } from '#server/database/opportunities.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import type { ChangeValue } from '#server/utils/change-events.ts'
import { applyFieldChanges } from '#server/utils/change-events.ts'
import { toDateOnly } from '#server/utils/dates.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeOpportunity } from '#server/utils/serializers/opportunities.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'
import { assertActiveUser } from '#server/utils/users.ts'
import { requestToday } from '#server/utils/time-zone.ts'
import type { UpdateOpportunityRequest } from '#shared/schemas/index.ts'
import { UpdateOpportunityRequest as UpdateOpportunityRequestSchema } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Opportunities'],
        summary: 'Update an opportunity',
        description:
            'Every changed field is recorded in the change log as a manual edit. Moving to "received" fills received_at with today when it is empty.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateOpportunityRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated opportunity',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Opportunity' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const opportunityId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdateOpportunityRequestSchema })
    const existing = await findOpportunity({ opportunityId })
    if (!existing) {
        throw notFound({ resource: 'Opportunity' })
    }
    await assertActiveUser({ userId: body.owner_id })
    const changes = await toTrackedChanges({ body, hasReceivedAt: existing.received_at !== null })
    const events = await applyFieldChanges({
        entityType: 'opportunity',
        entityId: opportunityId,
        changes,
        source: 'manual',
        actorUserId: ctx.user.id,
        effectiveOn: requestToday({ event }),
    })
    if (events.length > 0) {
        await recordAudit({
            actor: ctx.actor,
            action: 'opportunity.updated',
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { fields: events.map(change => change.field) },
            ip: requestIp({ event }),
        })
    }
    const opportunity = await findOpportunity({ opportunityId })
    return serializeOpportunity({ opportunity: opportunity!, stageProbabilities: await readStageProbabilities() })
})

/**
 * Turn the request into tracked-field changes: the goal type becomes a goal id, and marking an
 * opportunity received stamps today's date when none was given.
 *
 * @param input.body - The validated request.
 * @param input.hasReceivedAt - Whether the opportunity already has a received date.
 * @returns Field → new value.
 */
async function toTrackedChanges({ body, hasReceivedAt }: { body: UpdateOpportunityRequest; hasReceivedAt: boolean }) {
    const { goal_type: goalType, ...fields } = body
    const changes: Record<string, ChangeValue | undefined> = { ...fields }
    if (goalType) {
        changes.goal_id = (await goalIdsByType()).get(goalType)
    }
    if (body.stage === 'received' && body.received_at === undefined && !hasReceivedAt) {
        changes.received_at = toDateOnly({ date: new Date() })
    }
    return changes
}
