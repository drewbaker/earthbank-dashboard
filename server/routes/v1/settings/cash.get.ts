import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { readCashSettings } from '#server/utils/cash-settings.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Settings'],
        summary: 'Get cash settings',
        description: 'Manual balance, burn override, lookback, excluded categories and which goals fund operations.',
        responses: {
            200: {
                description: 'Cash settings',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/CashSettings' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    return readCashSettings()
})
