import { z } from 'zod'
import { USER_ROLES } from '#shared/constants/roles.ts'
import { IsoDateTime, listOf } from '#shared/schemas/common.ts'

export const User = z.object({
    id: z.string(),
    email: z.email(),
    name: z.string(),
    avatar_url: z.string().nullable(),
    role: z.enum(USER_ROLES),
    last_sign_in_at: IsoDateTime.nullable(),
    deactivated_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
})
export type User = z.infer<typeof User>

export const UserList = listOf(User)
export type UserList = z.infer<typeof UserList>

export const CurrentUser = z.object({
    user: User,
})
export type CurrentUser = z.infer<typeof CurrentUser>
