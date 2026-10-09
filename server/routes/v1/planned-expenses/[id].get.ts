import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findPlannedExpense } from '#server/database/planned-expenses.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializePlannedExpense } from '#server/utils/serializers/planned-expenses.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Forecast'],
        summary: 'Get a planned expense',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The planned expense',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/PlannedExpense' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const plannedExpense = await findPlannedExpense({ plannedExpenseId: getRouterParam(event, 'id') ?? '' })
    if (!plannedExpense) {
        throw notFound({ resource: 'Planned expense' })
    }
    return serializePlannedExpense({ plannedExpense })
})
