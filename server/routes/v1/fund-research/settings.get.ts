import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { readFundResearchSettings } from '#server/utils/funds/research-settings.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Research settings',
        description:
            'Spider on/off, the fund limit, the monthly budget, per-fund search and page caps, and the confidence floor.',
        responses: {
            200: {
                description: 'Settings',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundResearchSettings' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    return readFundResearchSettings()
})
