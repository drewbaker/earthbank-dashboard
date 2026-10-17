import { createSignInLinkRow } from '#server/database/sign-in-links.ts'
import { config } from '#server/utils/config.ts'
import { hashToken, newOpaqueToken } from '#server/utils/crypto.ts'
import { renderEmail } from '#server/utils/email/layout.ts'
import { enqueueEmail } from '#server/utils/jobs/enqueue.ts'
import { emailDomain } from '#shared/utils/email-addresses.ts'

// Guests outside the Workspace can't use Google sign-in (the OAuth app is Internal), so they sign in
// with one-time links sent to their address. An invitation link lasts a week, giving people time to
// see it; a link asked for on the login page lasts half an hour.
const LINK_LIFETIME_MS = {
    invitation: 7 * 24 * 60 * 60 * 1000,
    sign_in: 30 * 60 * 1000,
} as const

// "Email me a link" is rate limited per address and per IP, in memory: the app runs as one process,
// and a restart clearing the counts is harmless.
const REQUEST_WINDOW_MS = 15 * 60 * 1000
const MAX_REQUESTS_PER_EMAIL = 3
const MAX_REQUESTS_PER_IP = 10
const recentRequests = new Map<string, { count: number; resetsAt: number }>()

export type SignInLinkPurpose = keyof typeof LINK_LIFETIME_MS

/**
 * Whether an address is on one of Earth Bank's own domains (staff sign in with Google, not links).
 *
 * @param input.email - A lowercased address.
 * @returns True for @theearthbank.org and its alias domains.
 */
export function isWorkspaceEmail({ email }: { email: string }) {
    return config.internalEmailDomains.includes(emailDomain({ email }))
}

/**
 * Create a one-time sign-in link for a user.
 *
 * The token goes in the URL's fragment (`#token=…`), which browsers never send to a server, so it
 * stays out of request logs and Referer headers; the page posts it to redeem it.
 *
 * @param input.userId - Who it signs in.
 * @param input.purpose - `invitation` (lasts 7 days) or `sign_in` (30 minutes).
 * @param input.redirectPath - Same-site path to open afterwards.
 * @param input.now - Current time.
 * @returns The full URL to email.
 */
export async function issueSignInLink({
    userId,
    purpose,
    redirectPath = '/',
    now = new Date(),
}: {
    userId: string
    purpose: SignInLinkPurpose
    redirectPath?: string
    now?: Date
}) {
    const token = newOpaqueToken()
    await createSignInLinkRow({
        userId,
        tokenHash: hashToken({ token }),
        purpose,
        expiresAt: new Date(now.getTime() + LINK_LIFETIME_MS[purpose]),
    })
    const fragment = new URLSearchParams({ token, ...(redirectPath === '/' ? {} : { redirect: redirectPath }) })
    return `${config.appUrl}/login/link#${fragment.toString()}`
}

/**
 * Email a guest their invitation, with a link that signs them straight in.
 *
 * @param input.userId - The invited user.
 * @param input.email - Their address.
 * @param input.inviterName - Who invited them, for the heading.
 * @returns Resolves once the email is queued.
 */
export async function sendInvitationEmail({
    userId,
    email,
    inviterName,
}: {
    userId: string
    email: string
    inviterName: string
}) {
    const url = await issueSignInLink({ userId, purpose: 'invitation' })
    const { html, text } = renderEmail({
        heading: `${inviterName} invited you to the Earth Bank Dashboard`,
        paragraphs: [
            'The dashboard is where the Earth Bank team tracks fundraising: funders, asks, tasks and cash runway.',
            'This button signs you in. It works once and expires in 7 days.',
            `After that, go to ${config.appUrl}/login and enter your email address to get a new sign-in link.`,
        ],
        buttonLabel: 'Sign in',
        buttonUrl: url,
    })
    await enqueueEmail({ to: email, subject: `${inviterName} invited you to the Earth Bank Dashboard`, html, text })
}

/**
 * Email a guest a link to sign in, asked for on the login page.
 *
 * @param input.userId - The user.
 * @param input.email - Their address.
 * @param input.redirectPath - Same-site path to open afterwards.
 * @returns Resolves once the email is queued.
 */
export async function sendSignInLinkEmail({
    userId,
    email,
    redirectPath,
}: {
    userId: string
    email: string
    redirectPath: string
}) {
    const url = await issueSignInLink({ userId, purpose: 'sign_in', redirectPath })
    const { html, text } = renderEmail({
        heading: 'Sign in to the Earth Bank Dashboard',
        paragraphs: [
            'Use this button to sign in. It works once and expires in 30 minutes.',
            "If you didn't ask for this, you can ignore this email.",
        ],
        buttonLabel: 'Sign in',
        buttonUrl: url,
    })
    await enqueueEmail({ to: email, subject: 'Your Earth Bank Dashboard sign-in link', html, text })
}

/**
 * Count a request for a sign-in link, and say whether it's over the limit.
 *
 * @param input.email - The address asked for.
 * @param input.ip - The caller's IP, if known.
 * @param input.now - Current time in ms.
 * @returns True when this request should be refused.
 */
export function isSignInLinkRequestLimited({
    email,
    ip,
    now = Date.now(),
}: {
    email: string
    ip: string | null
    now?: number
}) {
    const isEmailLimited = countRequest({ key: `email:${email}`, limit: MAX_REQUESTS_PER_EMAIL, now })
    const isIpLimited = ip ? countRequest({ key: `ip:${ip}`, limit: MAX_REQUESTS_PER_IP, now }) : false
    return isEmailLimited || isIpLimited
}

/**
 * Add one to a rate-limit counter.
 *
 * @param input.key - What's being counted.
 * @param input.limit - Most allowed per window.
 * @param input.now - Current time in ms.
 * @returns True when the count is now over the limit.
 */
function countRequest({ key, limit, now }: { key: string; limit: number; now: number }) {
    const entry = recentRequests.get(key)
    if (!entry || entry.resetsAt <= now) {
        recentRequests.set(key, { count: 1, resetsAt: now + REQUEST_WINDOW_MS })
        return false
    }
    entry.count++
    return entry.count > limit
}
