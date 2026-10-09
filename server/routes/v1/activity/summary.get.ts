import { defineRouteMeta } from 'nitropack/runtime'
import { countPendingChangeEvents } from '#server/database/change-events.ts'
import { countDraftFunders } from '#server/database/funders.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Change log'],
        summary: 'What needs review',
        description: 'Counts of AI suggestions and drafted funders waiting on the Activity page.',
        responses: {
            200: {
                description: 'Counts',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ActivitySummary' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const [pendingChanges, draftFunders] = await Promise.all([countPendingChangeEvents(), countDraftFunders()])
    return { pending_changes: pendingChanges, draft_funders: draftFunders }
})
