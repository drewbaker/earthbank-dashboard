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

/**
 * Mark a mailbox as waiting for a sync (when one is queued), unless one is already running.
 *
 * @param input.mailboxConnectionId - The connection.
 * @returns Resolves once updated.
 */
export async function markMailboxSyncQueued({ mailboxConnectionId }: { mailboxConnectionId: string }) {
    await db().mailboxConnection.updateMany({
        where: { id: mailboxConnectionId, sync_state: { not: 'running' } },
        data: { sync_state: 'queued' },
    })
}

/**
 * Record the progress of a running sync.
 *
 * @param input.mailboxConnectionId - The connection.
 * @param input.phase - `searching`, `checking` or `reading`.
 * @param input.done - Items done in this phase.
 * @param input.total - Items in this phase, when known.
 * @param input.startedAt - Set when the sync starts.
 * @returns Resolves once updated.
 */
export async function recordMailboxSyncProgress({
    mailboxConnectionId,
    phase,
    done,
    total,
    startedAt,
}: {
    mailboxConnectionId: string
    phase: 'searching' | 'checking' | 'reading'
    done: number
    total: number | null
    startedAt?: Date
}) {
    await db().mailboxConnection.update({
        where: { id: mailboxConnectionId },
        data: {
            sync_state: 'running',
            sync_phase: phase,
            sync_done: done,
            sync_total: total,
            ...(startedAt ? { sync_started_at: startedAt } : {}),
        },
    })
}

/**
 * Record that a sync ended, with what it did when it completed.
 *
 * @param input.mailboxConnectionId - The connection.
 * @param input.result - Counts of the finished sync, or null when it failed or was skipped.
 * @returns Resolves once updated.
 */
export async function finishMailboxSync({
    mailboxConnectionId,
    result,
}: {
    mailboxConnectionId: string
    result: { matched: number; processed: number; applied: number; pending: number; finished_at: string } | null
}) {
    await db().mailboxConnection.updateMany({
        where: { id: mailboxConnectionId },
        data: {
            sync_state: 'idle',
            sync_phase: null,
            sync_done: 0,
            sync_total: null,
            ...(result ? { last_sync_result: result } : {}),
        },
    })
}
