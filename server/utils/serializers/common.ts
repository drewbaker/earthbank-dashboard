import type { User as UserRow } from '#server/generated/prisma/client.ts'
import type { UserSummary } from '#shared/schemas/index.ts'

/**
 * The short form of a user embedded in other resources.
 *
 * @param input.user - The user row, or null.
 * @returns `{ id, name, avatar_url }`, or null.
 */
export function serializeUserSummary({ user }: { user: UserRow | null | undefined }): UserSummary | null {
    return user ? { id: user.id, name: user.name, avatar_url: userAvatarUrl({ user }) } : null
}

/**
 * The picture to show for a user: the one they uploaded, else their Google profile picture.
 *
 * The uploaded picture's URL carries its upload time, so browsers can cache it until it changes.
 *
 * @param input.user - The user row.
 * @returns An image URL, or null when there's no picture (the UI shows initials).
 */
export function userAvatarUrl({ user }: { user: UserRow }) {
    if (user.avatar_storage_key) {
        return `/v1/users/${user.id}/avatar?v=${user.avatar_updated_at?.getTime() ?? 0}`
    }
    return user.avatar_url
}
