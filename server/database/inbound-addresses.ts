import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Replace a user's forwarding address: revoke the current one and create a new one.
 *
 * @param input.userId - The user.
 * @param input.tokenHash - SHA-256 of the new token.
 * @param input.tokenEncrypted - Encrypted new token (so Settings can show the address).
 * @param input.now - Current time.
 * @returns The new address row.
 */
export async function replaceInboundAddress({
    userId,
    tokenHash,
    tokenEncrypted,
    now,
}: {
    userId: string
    tokenHash: string
    tokenEncrypted: string
    now: Date
}) {
    const [, created] = await db().$transaction([
        db().inboundAddress.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: now } }),
        db().inboundAddress.create({
            data: {
                id: newId({ kind: 'inboundAddress' }),
                user_id: userId,
                token_hash: tokenHash,
                token_encrypted: tokenEncrypted,
            },
        }),
    ])
    return created
}

/**
 * A user's current forwarding address.
 *
 * @param input.userId - The user.
 * @returns The address row, or null.
 */
export function findActiveInboundAddressForUser({ userId }: { userId: string }) {
    return db().inboundAddress.findFirst({ where: { user_id: userId, revoked_at: null }, orderBy: { id: 'desc' } })
}

/**
 * Find a live forwarding address by token hash, with its user.
 *
 * @param input.tokenHash - SHA-256 of the token from the address.
 * @returns The address with its user, or null.
 */
export function findInboundAddressByTokenHash({ tokenHash }: { tokenHash: string }) {
    return db().inboundAddress.findFirst({
        where: { token_hash: tokenHash, revoked_at: null },
        include: { user: true },
    })
}
