import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Save (or replace) a user's Gmail connection.
 *
 * @param input.userId - The user.
 * @param input.googleEmail - The connected Google account.
 * @param input.refreshTokenEncrypted - Encrypted refresh token.
 * @param input.scopes - Granted scopes, space-separated.
 * @returns The connection row.
 */
export function upsertMailboxConnection({
    userId,
    googleEmail,
    refreshTokenEncrypted,
    scopes,
}: {
    userId: string
    googleEmail: string
    refreshTokenEncrypted: string
    scopes: string
}) {
    const fields = {
        google_email: googleEmail,
        refresh_token_encrypted: refreshTokenEncrypted,
        scopes,
        status: 'active',
        last_error: null,
    }
    return db().mailboxConnection.upsert({
        where: { user_id: userId },
        create: { id: newId({ kind: 'mailboxConnection' }), user_id: userId, ...fields },
        update: fields,
    })
}

/**
 * A user's Gmail connection.
 *
 * @param input.userId - The user.
 * @returns The connection, or null.
 */
export function findMailboxConnectionForUser({ userId }: { userId: string }) {
    return db().mailboxConnection.findUnique({ where: { user_id: userId } })
}

/**
 * A connection by id.
 *
 * @param input.mailboxConnectionId - The connection.
 * @returns The connection, or null.
 */
export function findMailboxConnection({ mailboxConnectionId }: { mailboxConnectionId: string }) {
    return db().mailboxConnection.findUnique({ where: { id: mailboxConnectionId } })
}

/**
 * Every working connection of an active user.
 *
 * @returns Connections.
 */
export function listActiveMailboxConnections() {
    return db().mailboxConnection.findMany({ where: { status: 'active', user: { deactivated_at: null } } })
}

/**
 * Record the outcome of a sync.
 *
 * @param input.mailboxConnectionId - The connection.
 * @param input.lastSyncedAt - Set on success.
 * @param input.lastError - Set on failure (null clears it).
 * @param input.status - New status, if changing.
 * @returns The updated connection.
 */
export function recordMailboxSync({
    mailboxConnectionId,
    lastSyncedAt,
    lastError,
    status,
}: {
    mailboxConnectionId: string
    lastSyncedAt?: Date
    lastError: string | null
    status?: 'active' | 'error'
}) {
    return db().mailboxConnection.update({
        where: { id: mailboxConnectionId },
        data: { last_synced_at: lastSyncedAt, last_error: lastError, status },
    })
}

/**
 * Remove a user's Gmail connection.
 *
 * @param input.userId - The user.
 * @returns The number removed.
 */
export async function deleteMailboxConnection({ userId }: { userId: string }) {
    const result = await db().mailboxConnection.deleteMany({ where: { user_id: userId } })
    return result.count
}
