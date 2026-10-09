import { defineRouteMeta } from 'nitropack/runtime'
import { listScenarioRows } from '#server/database/scenarios.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeScenario } from '#server/utils/serializers/scenarios.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Forecast'],
        summary: 'List saved scenarios',
        responses: {
            200: {
                description: 'Scenarios, newest first',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ScenarioList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const scenarios = await listScenarioRows()
    return { data: scenarios.map(scenario => serializeScenario({ scenario })), next_cursor: null, has_more: false }
})
