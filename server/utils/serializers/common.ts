import type { User as UserRow } from '#server/generated/prisma/client.ts'
import type { UserSummary } from '#shared/schemas/index.ts'

/**
 * The short form of a user embedded in other resources.
 *
 * @param input.user - The user row, or null.
 * @returns `{ id, name, avatar_url }`, or null.
 */
export function serializeUserSummary({ user }: { user: UserRow | null | undefined }): UserSummary | null {
    return user ? { id: user.id, name: user.name, avatar_url: user.avatar_url } : null
}
