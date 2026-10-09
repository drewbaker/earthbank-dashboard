import { defineRouteMeta } from 'nitropack/runtime'
import { findMailboxConnectionForUser } from '#server/database/mailboxes.ts'
import type { MailboxConnection } from '#server/generated/prisma/client.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { hasGoogleScope } from '#server/utils/auth/google.ts'
import { config } from '#server/utils/config.ts'
import { toIsoDateTime } from '#server/utils/dates.ts'
import { forwardingAddressFor } from '#server/utils/mail/inbound.ts'
import { MailboxSyncStatus } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Email'],
        summary: 'My email connection',
        description: "The signed-in user's Gmail connection and private forwarding address.",
        responses: {
            200: {
                description: 'Mailbox status',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MailboxStatus' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const connection = await findMailboxConnectionForUser({ userId: ctx.user.id })
    return {
        is_ai_configured: Boolean(config.anthropicApiKey),
        is_inbound_configured: Boolean(config.resendWebhookSecret),
        connection: connection
            ? {
                  google_email: connection.google_email,
                  status: connection.status === 'error' ? 'error' : 'active',
                  last_synced_at: toIsoDateTime({ date: connection.last_synced_at }),
                  last_error: connection.last_error,
                  can_create_drafts: hasGoogleScope({ grantedScopes: connection.scopes, scope: 'gmail.compose' }),
                  sync: serializeSyncStatus({ connection, now: new Date() }),
              }
            : null,
        forwarding_address: await forwardingAddressFor({ userId: ctx.user.id }),
    }
})

// A sync that hasn't reported progress for this long was interrupted (e.g. by a deploy); its retry
// will report again when it starts.
const STALE_SYNC_MS = 20 * 60 * 1000

/**
 * The progress of the mailbox's sync, as shown in Settings → Email.
 *
 * @param input.connection - The mailbox connection row.
 * @param input.now - Current time, to spot an interrupted sync.
 * @returns The sync status.
 */
function serializeSyncStatus({ connection, now }: { connection: MailboxConnection; now: Date }): MailboxSyncStatus {
    const isStale = now.getTime() - connection.updated_at.getTime() > STALE_SYNC_MS
    const state = isStale || !['queued', 'running'].includes(connection.sync_state) ? 'idle' : connection.sync_state
    const lastResult = MailboxSyncStatus.shape.last_result.safeParse(connection.last_sync_result)
    return {
        state: state as MailboxSyncStatus['state'],
        phase:
            state === 'running' && ['searching', 'checking', 'reading'].includes(connection.sync_phase ?? '')
                ? (connection.sync_phase as MailboxSyncStatus['phase'])
                : null,
        done: state === 'running' ? connection.sync_done : 0,
        total: state === 'running' ? connection.sync_total : null,
        started_at: state === 'running' ? toIsoDateTime({ date: connection.sync_started_at }) : null,
        last_result: lastResult.success ? lastResult.data : null,
    }
}
