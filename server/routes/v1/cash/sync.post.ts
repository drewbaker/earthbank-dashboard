import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { config } from '#server/utils/config.ts'
import { badRequest } from '#server/utils/errors.ts'
import { enqueueBookkeepingSync } from '#server/utils/jobs/enqueue.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Cash'],
        summary: 'Sync bank data now',
        description: 'Queues a Bookeeping.ai sync (it also runs every hour).',
        responses: { 202: { description: 'Sync queued' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    if (!config.bookkeepingApiKey) {
        throw badRequest({
            message: 'Add BOOKEEPING_API_KEY to connect Bookeeping.ai first.',
            code: 'bookkeeping_not_configured',
        })
    }
    await enqueueBookkeepingSync()
    await recordAudit({
        actor: ctx.actor,
        action: 'cash.sync_requested',
        entityType: 'bookkeeping',
        entityId: 'sync',
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 202)
    return { queued: true }
})
