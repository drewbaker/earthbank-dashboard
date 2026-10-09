import { defineRouteMeta } from 'nitropack/runtime'
import { listPlannedExpenseRows } from '#server/database/planned-expenses.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializePlannedExpense } from '#server/utils/serializers/planned-expenses.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Forecast'],
        summary: 'List planned expenses',
        description: 'Spending the team has decided on (one-off or monthly); part of the base forecast.',
        responses: {
            200: {
                description: 'Planned expenses, soonest first',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/PlannedExpenseList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const rows = await listPlannedExpenseRows()
    return {
        data: rows.map(plannedExpense => serializePlannedExpense({ plannedExpense })),
        next_cursor: null,
        has_more: false,
    }
})
