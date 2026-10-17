import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Store a new one-time sign-in link. Only the token's hash is stored.
 *
 * @param input.userId - Who it signs in.
 * @param input.tokenHash - SHA-256 of the token in the emailed URL.
 * @param input.purpose - `invitation` or `sign_in`.
 * @param input.expiresAt - When it stops working.
 * @returns The link row.
 */
export function createSignInLinkRow({
    userId,
    tokenHash,
    purpose,
    expiresAt,
}: {
    userId: string
    tokenHash: string
    purpose: 'invitation' | 'sign_in'
    expiresAt: Date
}) {
    return db().signInLink.create({
        data: {
            id: newId({ kind: 'signInLink' }),
            user_id: userId,
            token_hash: tokenHash,
            purpose,
            expires_at: expiresAt,
        },
    })
}

/**
 * Use up a sign-in link: marks it used only if it's unused, unexpired and its user is active, so two
 * clicks can never both sign in.
 *
 * @param input.tokenHash - SHA-256 of the token.
 * @param input.now - Current time.
 * @returns The link with its user, or null when it can't be used.
 */
export async function consumeSignInLink({ tokenHash, now }: { tokenHash: string; now: Date }) {
    const usable = { token_hash: tokenHash, used_at: null, expires_at: { gt: now }, user: { deactivated_at: null } }
    const result = await db().signInLink.updateMany({ where: usable, data: { used_at: now } })
    if (result.count === 0) {
        return null
    }
    return db().signInLink.findUnique({ where: { token_hash: tokenHash }, include: { user: true } })
}

/**
 * Delete links that have expired or were used.
 *
 * @param input.now - Current time.
 * @returns The number of links deleted.
 */
export async function deleteSpentSignInLinks({ now }: { now: Date }) {
    const result = await db().signInLink.deleteMany({
        where: { OR: [{ expires_at: { lte: now } }, { used_at: { not: null } }] },
    })
    return result.count
}
