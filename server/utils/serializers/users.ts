import type { User as UserRow } from '#server/generated/prisma/client.ts'
import { userAvatarUrl } from '#server/utils/serializers/common.ts'
import { USER_ROLES } from '#shared/constants/roles.ts'
import type { User, UserPreferences } from '#shared/schemas/index.ts'
import { UserPreferences as UserPreferencesSchema } from '#shared/schemas/index.ts'

/**
 * Public shape of a user. `google_sub` and the picture's storage key stay internal.
 *
 * @param input.user - The user row.
 * @returns The API representation.
 */
export function serializeUser({ user }: { user: UserRow }): User {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: userAvatarUrl({ user }),
        has_uploaded_avatar: Boolean(user.avatar_storage_key),
        role: USER_ROLES.find(role => role === user.role) ?? 'admin',
        sign_in_method: user.google_sub ? 'google' : 'email_link',
        invited_at: user.invited_at?.toISOString() ?? null,
        last_sign_in_at: user.last_sign_in_at?.toISOString() ?? null,
        deactivated_at: user.deactivated_at?.toISOString() ?? null,
        created_at: user.created_at.toISOString(),
    }
}

/**
 * A user's personal preferences, with defaults for anything never set.
 *
 * @param input.user - The user row.
 * @returns The preferences.
 */
export function serializeUserPreferences({ user }: { user: UserRow }): UserPreferences {
    const parsed = UserPreferencesSchema.safeParse(user.settings ?? {})
    return parsed.success ? parsed.data : UserPreferencesSchema.parse({})
}
