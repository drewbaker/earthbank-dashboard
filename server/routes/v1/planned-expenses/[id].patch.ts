import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findPlannedExpense, updatePlannedExpenseRow } from '#server/database/planned-expenses.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { centsToBigInt, fromDateOnly, toDateOnly } from '#server/utils/dates.ts'
import { badRequest, notFound } from '#server/utils/errors.ts'
import { serializePlannedExpense } from '#server/utils/serializers/planned-expenses.ts'
import { UpdatePlannedExpenseRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Forecast'],
        summary: 'Update a planned expense',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/UpdatePlannedExpenseRequest' } },
            },
        },
        responses: {
            200: {
                description: 'The planned expense',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/PlannedExpense' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const plannedExpenseId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdatePlannedExpenseRequest })
    const existing = await findPlannedExpense({ plannedExpenseId })
    if (!existing) {
        throw notFound({ resource: 'Planned expense' })
    }
    const startsOn = body.starts_on ?? toDateOnly({ date: existing.starts_on })!
    const endsOn = body.ends_on === undefined ? toDateOnly({ date: existing.ends_on }) : body.ends_on
    if (endsOn && endsOn < startsOn) {
        throw badRequest({ message: 'The end must be after the start.', code: 'invalid_dates' })
    }
    const plannedExpense = await updatePlannedExpenseRow({
        plannedExpenseId,
        data: {
            label: body.label,
            kind: body.kind,
            amount_cents: body.amount_cents === undefined ? undefined : centsToBigInt({ cents: body.amount_cents })!,
            starts_on: body.starts_on === undefined ? undefined : fromDateOnly({ value: body.starts_on })!,
            ends_on: body.ends_on === undefined ? undefined : fromDateOnly({ value: body.ends_on }),
            notes: body.notes,
        },
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'planned_expense.updated',
        entityType: 'planned_expense',
        entityId: plannedExpenseId,
        changes: body,
        ip: requestIp({ event }),
    })
    return serializePlannedExpense({ plannedExpense })
})
