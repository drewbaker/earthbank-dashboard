import { defineRouteMeta } from 'nitropack/runtime'
import { listGoalsWithOpportunities } from '#server/database/goals.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeGoal } from '#server/utils/serializers/goals.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Goals'],
        summary: 'List funding goals',
        description: 'The three goals with targets and pipeline totals (open, weighted, committed, received).',
        responses: {
            200: {
                description: 'All goals',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GoalList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const [goals, stageProbabilities] = await Promise.all([listGoalsWithOpportunities(), readStageProbabilities()])
    return { data: goals.map(goal => serializeGoal({ goal, stageProbabilities })), next_cursor: null, has_more: false }
})
