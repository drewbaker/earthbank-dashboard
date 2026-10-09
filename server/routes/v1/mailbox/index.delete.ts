import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { deleteMailboxConnection, findMailboxConnectionForUser } from '#server/database/mailboxes.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { googleOAuthClient } from '#server/utils/auth/google.ts'
import { decryptSecret } from '#server/utils/crypto.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Email'],
        summary: 'Disconnect Gmail',
        description:
            "Revokes the dashboard's access at Google and deletes the stored token. Emails already read stay in the history.",
        responses: { 204: { description: 'Disconnected' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const connection = await findMailboxConnectionForUser({ userId: ctx.user.id })
    if (connection) {
        const refreshToken = decryptSecret({ encrypted: connection.refresh_token_encrypted })
        if (refreshToken) {
            // Best effort: the token is deleted either way.
            await googleOAuthClient()
                .revokeToken(refreshToken)
                .catch(error =>
                    console.info('[mail] token revoke failed', error instanceof Error ? error.message : error),
                )
        }
        await deleteMailboxConnection({ userId: ctx.user.id })
        await recordAudit({
            actor: ctx.actor,
            action: 'mailbox.disconnected',
            entityType: 'mailbox_connection',
            entityId: connection.id,
            ip: requestIp({ event }),
        })
    }
    setResponseStatus(event, 204)
    return null
})
