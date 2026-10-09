import { findMailboxConnectionForUser } from '#server/database/mailboxes.ts'
import { listKnowledgeSourcesConnectedBy } from '#server/database/knowledge.ts'
import { googleOAuthClient } from '#server/utils/auth/google.ts'

/**
 * Revoke a person's Google grant to the dashboard once nothing uses it any more.
 *
 * Gmail and Drive access share one grant per person (incremental authorization), and revoking any
 * token revokes the whole grant. So disconnecting Gmail must not revoke while a Drive folder they
 * connected still needs it, and the other way round. Call this after deleting the row.
 *
 * @param input.userId - The person.
 * @param input.refreshToken - The token that was just disconnected.
 * @returns Whether the grant was revoked.
 */
export async function revokeGoogleAccessIfUnused({ userId, refreshToken }: { userId: string; refreshToken: string }) {
    const [mailbox, sources] = await Promise.all([
        findMailboxConnectionForUser({ userId }),
        listKnowledgeSourcesConnectedBy({ userId }),
    ])
    if (mailbox || sources.some(source => source.refresh_token_encrypted)) {
        return false
    }
    // Best effort: the stored token is gone either way.
    await googleOAuthClient()
        .revokeToken(refreshToken)
        .catch(error => console.info('[auth] token revoke failed', error instanceof Error ? error.message : error))
    return true
}
