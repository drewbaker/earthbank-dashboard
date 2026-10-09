import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findMailboxConnectionForUser } from '#server/database/mailboxes.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { config } from '#server/utils/config.ts'
import { badRequest } from '#server/utils/errors.ts'
import { enqueueMailboxSync } from '#server/utils/jobs/enqueue.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Email'],
        summary: 'Sync my Gmail now',
        description: 'Queues a sync of funder email (it also runs every 15 minutes).',
        responses: { 202: { description: 'Sync queued' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    if (!config.anthropicApiKey) {
        throw badRequest({
            message: 'Set ANTHROPIC_API_KEY so the dashboard can read email.',
            code: 'ai_not_configured',
        })
    }
    const connection = await findMailboxConnectionForUser({ userId: ctx.user.id })
    if (!connection || connection.status !== 'active') {
        throw badRequest({ message: 'Connect Gmail first.', code: 'mailbox_not_connected' })
    }
    await enqueueMailboxSync({ mailboxConnectionId: connection.id })
    await recordAudit({
        actor: ctx.actor,
        action: 'mailbox.sync_requested',
        entityType: 'mailbox_connection',
        entityId: connection.id,
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 202)
    return { queued: true }
})
