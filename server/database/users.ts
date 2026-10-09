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
