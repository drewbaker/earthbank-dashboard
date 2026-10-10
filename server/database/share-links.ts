import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Create a share link.
 *
 * @param input.label - What the team calls it, e.g. "Funders, October".
 * @param input.tokenHash - SHA-256 of the secret in the URL.
 * @param input.tokenEncrypted - The secret, encrypted, so Settings can show the link again.
 * @param input.passwordHash - scrypt hash of the password.
 * @param input.passwordEncrypted - The password, encrypted, so the team can see it again.
 * @param input.showNextSteps - Whether viewers see next steps.
 * @param input.createdByUserId - Who made it.
 * @returns The row with its creator.
 */
export function createShareLinkRow({
    label,
    tokenHash,
    tokenEncrypted,
    passwordHash,
    passwordEncrypted,
    showNextSteps,
    createdByUserId,
}: {
    label: string
    tokenHash: string
    tokenEncrypted: string
    passwordHash: string
    passwordEncrypted: string
    showNextSteps: boolean
    createdByUserId: string
}) {
    return db().shareLink.create({
        data: {
            id: newId({ kind: 'shareLink' }),
            label,
            token_hash: tokenHash,
            token_encrypted: tokenEncrypted,
            password_hash: passwordHash,
            password_encrypted: passwordEncrypted,
            show_next_steps: showNextSteps,
            created_by_user_id: createdByUserId,
        },
        include: { created_by: true },
    })
}

/**
 * Every link that hasn't been turned off, newest first.
 *
 * @returns Rows with their creators.
 */
export function listActiveShareLinks() {
    return db().shareLink.findMany({
        where: { revoked_at: null },
        include: { created_by: true },
        orderBy: { id: 'desc' },
    })
}

/**
 * Find a working link by the hash of its secret.
 *
 * @param input.tokenHash - SHA-256 of the secret in the URL.
 * @returns The link, or null when unknown or turned off.
 */
export function findActiveShareLinkByTokenHash({ tokenHash }: { tokenHash: string }) {
    return db().shareLink.findFirst({ where: { token_hash: tokenHash, revoked_at: null } })
}

/**
 * Find a working link by id.
 *
 * @param input.shareLinkId - The link.
 * @returns The link, or null.
 */
export function findActiveShareLink({ shareLinkId }: { shareLinkId: string }) {
    return db().shareLink.findFirst({ where: { id: shareLinkId, revoked_at: null } })
}

/**
 * Turn a link off for good.
 *
 * @param input.shareLinkId - The link.
 * @param input.revokedAt - When.
 * @returns The updated row.
 */
export function revokeShareLinkRow({ shareLinkId, revokedAt }: { shareLinkId: string; revokedAt: Date }) {
    return db().shareLink.update({ where: { id: shareLinkId }, data: { revoked_at: revokedAt } })
}

/**
 * Note that someone opened the link.
 *
 * @param input.shareLinkId - The link.
 * @param input.viewedAt - When.
 * @returns The updated row.
 */
export function recordShareLinkView({ shareLinkId, viewedAt }: { shareLinkId: string; viewedAt: Date }) {
    return db().shareLink.update({ where: { id: shareLinkId }, data: { last_viewed_at: viewedAt } })
}
