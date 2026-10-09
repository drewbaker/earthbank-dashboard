// Every user is an admin in v1; the list exists so viewer/editor can be added without a migration.
export const USER_ROLES = ['admin'] as const
export type UserRole = (typeof USER_ROLES)[number]
