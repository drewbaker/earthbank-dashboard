import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { loadForecastInputs } from '#server/utils/forecast.ts'
import { requestToday } from '#server/utils/time-zone.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Forecast'],
        summary: 'Forecast inputs',
        description:
            'Cash, burn, pipeline and milestones for the runway projection, which the dashboard runs in the browser (shared/forecast/project-runway.ts).',
        responses: {
            200: {
                description: 'Forecast inputs',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ForecastInputs' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    return loadForecastInputs({ today: requestToday({ event }) })
})
