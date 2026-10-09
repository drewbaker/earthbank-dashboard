import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Settings'],
        summary: 'Get stage probabilities',
        description:
            'The chance (0–100) that an opportunity at each stage lands; drives weighted totals and the forecast.',
        responses: {
            200: {
                description: 'Stage → probability',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/StageProbabilities' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    return readStageProbabilities()
})
