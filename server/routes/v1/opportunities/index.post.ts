import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findFunder } from '#server/database/funders.ts'
import { goalIdsByType } from '#server/database/goals.ts'
import { createOpportunityRow } from '#server/database/opportunities.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { centsToBigInt, fromDateOnly } from '#server/utils/dates.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeOpportunity } from '#server/utils/serializers/opportunities.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'
import { assertActiveUser } from '#server/utils/users.ts'
import { CreateOpportunityRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Opportunities'],
        summary: 'Create an opportunity',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOpportunityRequest' } } },
        },
        responses: {
            201: {
                description: 'Opportunity created',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Opportunity' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: CreateOpportunityRequest })
    const funder = await findFunder({ funderId: body.funder_id })
    if (!funder || funder.archived_at) {
        throw notFound({ resource: 'Funder' })
    }
    await assertActiveUser({ userId: body.owner_id })
    const goalIds = await goalIdsByType()
    const opportunity = await createOpportunityRow({
        funderId: funder.id,
        goalId: goalIds.get(body.goal_type)!,
        name: body.name,
        stage: body.stage,
        amountCents: centsToBigInt({ cents: body.amount_cents }),
        probabilityOverride: body.probability_override ?? null,
        expectedDecisionAt: fromDateOnly({ value: body.expected_decision_at }),
        expectedReceiptAt: fromDateOnly({ value: body.expected_receipt_at }),
        receivedAt: fromDateOnly({ value: body.received_at }),
        nextStep: body.next_step ?? null,
        ownerId: body.owner_id ?? null,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'opportunity.created',
        entityType: 'opportunity',
        entityId: opportunity.id,
        changes: { funder_id: funder.id, goal_type: body.goal_type, stage: body.stage },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializeOpportunity({ opportunity, stageProbabilities: await readStageProbabilities() })
})
