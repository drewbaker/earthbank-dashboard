import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { createPlannedExpenseRow } from '#server/database/planned-expenses.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { centsToBigInt, fromDateOnly } from '#server/utils/dates.ts'
import { serializePlannedExpense } from '#server/utils/serializers/planned-expenses.ts'
import { CreatePlannedExpenseRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Forecast'],
        summary: 'Add a planned expense',
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/CreatePlannedExpenseRequest' } },
            },
        },
        responses: {
            201: {
                description: 'The planned expense',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/PlannedExpense' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: CreatePlannedExpenseRequest })
    const plannedExpense = await createPlannedExpenseRow({
        label: body.label,
        kind: body.kind,
        amountCents: centsToBigInt({ cents: body.amount_cents })!,
        startsOn: fromDateOnly({ value: body.starts_on })!,
        endsOn: body.kind === 'monthly' ? fromDateOnly({ value: body.ends_on ?? null }) : null,
        notes: body.notes ?? null,
        createdById: ctx.user.id,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'planned_expense.created',
        entityType: 'planned_expense',
        entityId: plannedExpense.id,
        changes: body,
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializePlannedExpense({ plannedExpense })
})
