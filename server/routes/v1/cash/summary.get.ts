import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { loadCashSummary } from '#server/utils/cash.ts'
import { requestToday } from '#server/utils/time-zone.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Cash'],
        summary: 'Cash, burn and accounts',
        description:
            'Cash on hand (synced or manual), monthly burn (computed or overridden), recent history and sync status.',
        responses: {
            200: {
                description: 'The cash summary',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/CashSummary' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    return loadCashSummary({ today: requestToday({ event }) })
})
