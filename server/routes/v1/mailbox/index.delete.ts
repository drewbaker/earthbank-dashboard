import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { deleteMailboxConnection, findMailboxConnectionForUser } from '#server/database/mailboxes.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { decryptSecret } from '#server/utils/crypto.ts'
import { revokeGoogleAccessIfUnused } from '#server/utils/google-access.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Email'],
        summary: 'Disconnect Gmail',
        description:
            "Deletes the stored token and revokes the dashboard's access at Google (unless a Drive folder you connected still needs it). Emails already read stay in the history.",
        responses: { 204: { description: 'Disconnected' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const connection = await findMailboxConnectionForUser({ userId: ctx.user.id })
    if (connection) {
        const refreshToken = decryptSecret({ encrypted: connection.refresh_token_encrypted })
        await deleteMailboxConnection({ userId: ctx.user.id })
        if (refreshToken) {
            await revokeGoogleAccessIfUnused({ userId: ctx.user.id, refreshToken })
        }
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
