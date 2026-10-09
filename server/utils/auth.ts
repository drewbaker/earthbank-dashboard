import type { H3Event } from 'h3'
import { deleteCookie, getCookie, getHeader, setCookie } from 'h3'
import { createSessionRow, deleteSessionByTokenHash, findLiveSession, touchSession } from '#server/database/sessions.ts'
import { requestIp } from '#server/utils/api.ts'
import { config } from '#server/utils/config.ts'
import { hashToken, newOpaqueToken } from '#server/utils/crypto.ts'
import { unauthorized } from '#server/utils/errors.ts'

export const SESSION_COOKIE_NAME = 'earthbank_dashboard_session'

// Updating last_seen_at on every request would turn every read into a write; once a minute is plenty.
const SESSION_TOUCH_INTERVAL_MS = 60_000

export type AuthActor = { type: 'user'; userId: string } | { type: 'system'; label: string }

export type AuthUser = { id: string; email: string; name: string; avatar_url: string | null; role: string }

export type AuthContext = { user: AuthUser; actor: AuthActor; sessionId: string }

declare module 'h3' {
    interface H3EventContext {
        auth?: AuthContext | null
    }
}

/**
 * Resolve the session cookie into `event.context.auth` (null when signed out).
 *
 * @param input.event - The request.
 * @param input.now - Current time.
 * @returns The auth context, or null.
 */
export async function resolveAuth({ event, now = new Date() }: { event: H3Event; now?: Date }) {
    const token = getCookie(event, SESSION_COOKIE_NAME)
    if (!token) {
        return null
    }
    const session = await findLiveSession({ tokenHash: hashToken({ token }), now })
    if (!session) {
        return null
    }
    if (now.getTime() - session.last_seen_at.getTime() > SESSION_TOUCH_INTERVAL_MS) {
        await touchSession({ sessionId: session.id, seenAt: now })
    }
    const { user } = session
    return {
        user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, role: user.role },
        actor: { type: 'user', userId: user.id },
        sessionId: session.id,
    } satisfies AuthContext
}

/**
 * Require a signed-in user.
 *
 * @param input.event - The request; `10.auth.ts` must have resolved `event.context.auth`.
 * @returns `{ ctx }` with the user and actor.
 * @throws ApiError 401 `unauthorized` when signed out.
 */
export function requireUser({ event }: { event: H3Event }) {
    const ctx = event.context.auth
    if (!ctx) {
        throw unauthorized()
    }
    return { ctx }
}

/**
 * Start a session for a user and set the cookie.
 *
 * @param input.event - The request to attach the cookie to.
 * @param input.userId - The signed-in user.
 * @param input.now - Current time.
 * @returns Resolves once the session row exists and the cookie is set.
 */
export async function startSession({
    event,
    userId,
    now = new Date(),
}: {
    event: H3Event
    userId: string
    now?: Date
}) {
    const token = newOpaqueToken()
    const expiresAt = new Date(now.getTime() + config.sessionTtlDays * 24 * 60 * 60 * 1000)
    await createSessionRow({
        userId,
        tokenHash: hashToken({ token }),
        expiresAt,
        ip: requestIp({ event }),
        userAgent: getHeader(event, 'user-agent') ?? null,
    })
    setCookie(event, SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        path: '/',
        expires: expiresAt,
    })
}

/**
 * End the current session and clear the cookie.
 *
 * @param input.event - The request carrying the cookie.
 * @returns Resolves once the session row is gone.
 */
export async function endSession({ event }: { event: H3Event }) {
    const token = getCookie(event, SESSION_COOKIE_NAME)
    if (token) {
        await deleteSessionByTokenHash({ tokenHash: hashToken({ token }) })
    }
    deleteCookie(event, SESSION_COOKIE_NAME, { path: '/' })
}
