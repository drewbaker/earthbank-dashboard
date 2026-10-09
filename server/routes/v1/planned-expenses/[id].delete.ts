import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findPlannedExpense, updatePlannedExpenseRow } from '#server/database/planned-expenses.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Forecast'],
        summary: 'Remove a planned expense',
        description: 'Takes it out of the forecast (archived, so the audit log keeps the history).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Removed' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const plannedExpenseId = getRouterParam(event, 'id') ?? ''
    const existing = await findPlannedExpense({ plannedExpenseId })
    if (!existing) {
        throw notFound({ resource: 'Planned expense' })
    }
    await updatePlannedExpenseRow({ plannedExpenseId, data: { archived_at: new Date() } })
    await recordAudit({
        actor: ctx.actor,
        action: 'planned_expense.archived',
        entityType: 'planned_expense',
        entityId: plannedExpenseId,
        changes: { label: existing.label },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
