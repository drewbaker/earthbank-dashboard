import { defineRouteMeta } from 'nitropack/runtime'
import { findMailboxConnectionForUser } from '#server/database/mailboxes.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { hasGoogleScope } from '#server/utils/auth/google.ts'
import { config } from '#server/utils/config.ts'
import { toIsoDateTime } from '#server/utils/dates.ts'
import { forwardingAddressFor } from '#server/utils/mail/inbound.ts'

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
              }
            : null,
        forwarding_address: await forwardingAddressFor({ userId: ctx.user.id }),
    }
})
