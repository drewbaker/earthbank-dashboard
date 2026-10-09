import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Store a new session. Only the token's hash is stored.
 *
 * @param input.userId - The signed-in user.
 * @param input.tokenHash - SHA-256 of the cookie token.
 * @param input.expiresAt - Absolute expiry.
 * @param input.ip - Caller IP, if known.
 * @param input.userAgent - Caller user agent, if known.
 * @returns The session row.
 */
export function createSessionRow({
    userId,
    tokenHash,
    expiresAt,
    ip,
    userAgent,
}: {
    userId: string
    tokenHash: string
    expiresAt: Date
    ip: string | null
    userAgent: string | null
}) {
    return db().session.create({
        data: {
            id: newId({ kind: 'session' }),
            user_id: userId,
            token_hash: tokenHash,
            expires_at: expiresAt,
            ip,
            user_agent: userAgent,
        },
    })
}

/**
 * Find a live session (not expired, user not deactivated) with its user.
 *
 * @param input.tokenHash - SHA-256 of the cookie token.
 * @param input.now - Current time.
 * @returns The session with its user, or null.
 */
export function findLiveSession({ tokenHash, now }: { tokenHash: string; now: Date }) {
    return db().session.findFirst({
        where: { token_hash: tokenHash, expires_at: { gt: now }, user: { deactivated_at: null } },
        include: { user: true },
    })
}

/**
 * Record that a session was used.
 *
 * @param input.sessionId - The session.
 * @param input.seenAt - When it was used.
 * @returns The updated session row.
 */
export function touchSession({ sessionId, seenAt }: { sessionId: string; seenAt: Date }) {
    return db().session.update({ where: { id: sessionId }, data: { last_seen_at: seenAt } })
}

/**
 * Delete a session by token hash (sign out).
 *
 * @param input.tokenHash - SHA-256 of the cookie token.
 * @returns The number of sessions deleted.
 */
export async function deleteSessionByTokenHash({ tokenHash }: { tokenHash: string }) {
    const result = await db().session.deleteMany({ where: { token_hash: tokenHash } })
    return result.count
}

/**
 * Delete every expired session.
 *
 * @param input.now - Current time.
 * @returns The number of sessions deleted.
 */
export async function deleteExpiredSessions({ now }: { now: Date }) {
    const result = await db().session.deleteMany({ where: { expires_at: { lte: now } } })
    return result.count
}
