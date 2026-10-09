import type { User as UserRow } from '#server/generated/prisma/client.ts'
import type { User } from '#shared/schemas/index.ts'
import { USER_ROLES } from '#shared/constants/roles.ts'

/**
 * Public shape of a user. `google_sub` stays internal.
 *
 * @param input.user - The user row.
 * @returns The API representation.
 */
export function serializeUser({ user }: { user: UserRow }): User {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        role: USER_ROLES.find(role => role === user.role) ?? 'admin',
        last_sign_in_at: user.last_sign_in_at?.toISOString() ?? null,
        deactivated_at: user.deactivated_at?.toISOString() ?? null,
        created_at: user.created_at.toISOString(),
    }
}
