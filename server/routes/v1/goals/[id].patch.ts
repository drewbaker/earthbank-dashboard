import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findGoalWithOpportunities, updateGoalRow } from '#server/database/goals.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { centsToBigInt, fromDateOnly } from '#server/utils/dates.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeGoal } from '#server/utils/serializers/goals.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'
import { UpdateGoalRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Goals'],
        summary: 'Update a goal target',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateGoalRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated goal',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Goal' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const goalId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdateGoalRequest })
    if (!(await findGoalWithOpportunities({ goalId }))) {
        throw notFound({ resource: 'Goal' })
    }
    await updateGoalRow({
        goalId,
        name: body.name,
        targetAmountCents:
            body.target_amount_cents === undefined ? undefined : centsToBigInt({ cents: body.target_amount_cents }),
        targetDate: body.target_date === undefined ? undefined : fromDateOnly({ value: body.target_date }),
        notes: body.notes,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'goal.updated',
        entityType: 'goal',
        entityId: goalId,
        changes: body,
        ip: requestIp({ event }),
    })
    const goal = await findGoalWithOpportunities({ goalId })
    return serializeGoal({ goal: goal!, stageProbabilities: await readStageProbabilities() })
})
