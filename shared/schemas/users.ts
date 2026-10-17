import { z } from 'zod'
import { USER_ROLES } from '#shared/constants/roles.ts'
import { IsoDateTime, listOf } from '#shared/schemas/common.ts'

export const COLOR_MODES = ['light', 'dark', 'system'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

// Trimmed and lowercased before it's checked, so pasted addresses with stray spaces still work.
const GuestEmail = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'))

export const User = z.object({
    id: z.string(),
    email: z.email(),
    name: z.string(),
    /** The uploaded picture if there is one, else the Google profile picture. */
    avatar_url: z.string().nullable(),
    /** Whether the picture was uploaded in Settings → Profile (rather than taken from Google). */
    has_uploaded_avatar: z.boolean(),
    role: z.enum(USER_ROLES),
    /** Earth Bank staff sign in with Google; invited guests with an emailed link. */
    sign_in_method: z.enum(['google', 'email_link']),
    /** When a guest was invited (null for Workspace staff). */
    invited_at: IsoDateTime.nullable(),
    last_sign_in_at: IsoDateTime.nullable(),
    deactivated_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
})
export type User = z.infer<typeof User>

export const UserList = listOf(User)
export type UserList = z.infer<typeof UserList>

/** Personal preferences, stored on the user so they follow the person to any browser. */
export const UserPreferences = z.object({
    color_mode: z.enum(COLOR_MODES).default('system'),
})
export type UserPreferences = z.infer<typeof UserPreferences>

export const CurrentUser = z.object({
    user: User,
    preferences: UserPreferences,
})
export type CurrentUser = z.infer<typeof CurrentUser>

export const UpdatePreferencesRequest = z.object({
    color_mode: z.enum(COLOR_MODES).optional(),
})
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequest>

export const InviteUserRequest = z.object({
    name: z.string().trim().min(1, 'Name is required.').max(120),
    email: GuestEmail,
})
export type InviteUserRequest = z.infer<typeof InviteUserRequest>

export const RequestSignInLinkRequest = z.object({
    email: GuestEmail,
    /** Same-site path to open after signing in. */
    redirect: z.string().max(500).optional(),
})
export type RequestSignInLinkRequest = z.infer<typeof RequestSignInLinkRequest>

export const RedeemSignInLinkRequest = z.object({
    token: z.string().min(20).max(200),
    /** Same-site path to open afterwards; anything else falls back to `/`. */
    redirect: z.string().max(500).optional(),
})
export type RedeemSignInLinkRequest = z.infer<typeof RedeemSignInLinkRequest>

export const SignInLinkRedeemed = z.object({
    /** Where to go now that the session is started. */
    redirect: z.string(),
})
export type SignInLinkRedeemed = z.infer<typeof SignInLinkRedeemed>
