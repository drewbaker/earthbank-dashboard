import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Create or update a user from a verified Google identity.
 *
 * Matches on `google_sub` first, then on email (so a row created before someone's first sign-in is
 * claimed rather than duplicated). Name and avatar are refreshed on every sign-in.
 *
 * @param input.googleSub - Google's stable subject id.
 * @param input.email - Verified Workspace email, lowercased.
 * @param input.name - Display name from Google.
 * @param input.avatarUrl - Profile picture URL, if any.
 * @param input.signedInAt - When the sign-in happened.
 * @returns The user row.
 */
export async function upsertGoogleUser({
    googleSub,
    email,
    name,
    avatarUrl,
    signedInAt,
}: {
    googleSub: string
    email: string
    name: string
    avatarUrl: string | null
    signedInAt: Date
}) {
    const existing = await db().user.findFirst({ where: { OR: [{ google_sub: googleSub }, { email }] } })
    if (existing) {
        return db().user.update({
            where: { id: existing.id },
            data: { google_sub: googleSub, email, name, avatar_url: avatarUrl, last_sign_in_at: signedInAt },
        })
    }
    return db().user.create({
        data: {
            id: newId({ kind: 'user' }),
            google_sub: googleSub,
            email,
            name,
            avatar_url: avatarUrl,
            role: 'admin',
            last_sign_in_at: signedInAt,
        },
    })
}

/**
 * Find a user by id.
 *
 * @param input.userId - The user's id.
 * @returns The user row, or null.
 */
export function findUser({ userId }: { userId: string }) {
    return db().user.findUnique({ where: { id: userId } })
}

/**
 * The active team member an email address belongs to, including their alias on Earth Bank's other
 * domains (drew@resolvefund.org is drew@theearthbank.org).
 *
 * @param input.email - Lowercased address.
 * @param input.workspaceDomain - The primary domain, e.g. `theearthbank.org`.
 * @param input.internalDomains - All of Earth Bank's domains.
 * @returns The user, or null.
 */
export async function findActiveUserByEmail({
    email,
    workspaceDomain,
    internalDomains,
}: {
    email: string
    workspaceDomain: string
    internalDomains: string[]
}) {
    const [local, domain] = email.toLowerCase().split('@')
    if (!local || !domain || !internalDomains.includes(domain)) {
        return null
    }
    return db().user.findFirst({ where: { email: `${local}@${workspaceDomain}`, deactivated_at: null } })
}

/**
 * Find a user by Google subject id.
 *
 * @param input.googleSub - Google's stable subject id.
 * @returns The user row, or null.
 */
export function findUserByGoogleSub({ googleSub }: { googleSub: string }) {
    return db().user.findUnique({ where: { google_sub: googleSub } })
}

/**
 * List every user, active first, then by name.
 *
 * @returns User rows.
 */
export function listUsers() {
    return db().user.findMany({ orderBy: [{ deactivated_at: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }] })
}

/**
 * Deactivate a user and delete their sessions and Gmail connection, in one transaction. Drive
 * folders they connected keep their documents but lose their token until someone reconnects them.
 *
 * @param input.userId - The user to deactivate.
 * @param input.deactivatedAt - When it happened.
 * @returns The updated user row.
 */
export async function deactivateUser({ userId, deactivatedAt }: { userId: string; deactivatedAt: Date }) {
    const [user] = await db().$transaction([
        db().user.update({ where: { id: userId }, data: { deactivated_at: deactivatedAt } }),
        db().session.deleteMany({ where: { user_id: userId } }),
        db().signInLink.deleteMany({ where: { user_id: userId } }),
        db().mailboxConnection.deleteMany({ where: { user_id: userId } }),
        db().knowledgeSource.updateMany({
            where: { connected_by_id: userId },
            data: {
                refresh_token_encrypted: '',
                status: 'error',
                last_error: 'The person who connected this folder no longer has access. Reconnect it.',
            },
        }),
    ])
    return user
}

/**
 * Reactivate a previously deactivated user.
 *
 * @param input.userId - The user to reactivate.
 * @returns The updated user row.
 */
export function reactivateUser({ userId }: { userId: string }) {
    return db().user.update({ where: { id: userId }, data: { deactivated_at: null } })
}

/**
 * Find a user by email address.
 *
 * @param input.email - Lowercased address.
 * @returns The user row, or null.
 */
export function findUserByEmail({ email }: { email: string }) {
    return db().user.findUnique({ where: { email } })
}

/**
 * Create a guest account for someone outside the Workspace. They sign in with emailed links.
 *
 * @param input.email - Their lowercased address.
 * @param input.name - Their name, as the inviter typed it.
 * @param input.invitedById - Who invited them.
 * @param input.invitedAt - When.
 * @returns The user row.
 */
export function createInvitedUser({
    email,
    name,
    invitedById,
    invitedAt,
}: {
    email: string
    name: string
    invitedById: string
    invitedAt: Date
}) {
    return db().user.create({
        data: {
            id: newId({ kind: 'user' }),
            email,
            name,
            role: 'admin',
            invited_at: invitedAt,
            invited_by_id: invitedById,
        },
    })
}

/**
 * Record a sign-in that didn't go through Google (an emailed link).
 *
 * @param input.userId - The user.
 * @param input.signedInAt - When.
 * @returns The updated user row.
 */
export function recordUserSignIn({ userId, signedInAt }: { userId: string; signedInAt: Date }) {
    return db().user.update({ where: { id: userId }, data: { last_sign_in_at: signedInAt } })
}

/**
 * Save a user's personal preferences.
 *
 * @param input.userId - The user.
 * @param input.settings - The full, validated preferences object.
 * @returns The updated user row.
 */
export function updateUserSettings({ userId, settings }: { userId: string; settings: Record<string, unknown> }) {
    return db().user.update({ where: { id: userId }, data: { settings: settings as Prisma.InputJsonValue } })
}

/**
 * Point a user at a newly uploaded picture (or clear it with null).
 *
 * @param input.userId - The user.
 * @param input.storageKey - Storage key of the picture, or null to go back to the Google one.
 * @param input.updatedAt - When it changed.
 * @returns The updated user row.
 */
export function setUserAvatar({
    userId,
    storageKey,
    updatedAt,
}: {
    userId: string
    storageKey: string | null
    updatedAt: Date
}) {
    return db().user.update({
        where: { id: userId },
        data: { avatar_storage_key: storageKey, avatar_updated_at: updatedAt },
    })
}

/**
 * Keep a Google profile picture for someone who has none yet (seen when they connect Gmail).
 *
 * @param input.userId - The user.
 * @param input.avatarUrl - The Google picture URL.
 * @returns The number of rows updated (0 when they already had one).
 */
export async function fillGoogleAvatar({ userId, avatarUrl }: { userId: string; avatarUrl: string }) {
    const result = await db().user.updateMany({
        where: { id: userId, avatar_url: null },
        data: { avatar_url: avatarUrl },
    })
    return result.count
}
