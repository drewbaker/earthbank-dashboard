import type { H3Event } from 'h3'
import { defineEventHandler, getQuery, sendRedirect, setResponseHeader } from 'h3'
import { findUserByGoogleSub, upsertGoogleUser } from '#server/database/users.ts'
import { requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { startSession } from '#server/utils/auth.ts'
import { checkWorkspaceIdentity, completeGoogleSignIn } from '#server/utils/auth/google.ts'
import { config } from '#server/utils/config.ts'

// Google redirects here after sign-in. This is the only place accounts are created.
export default defineEventHandler(async event => {
    setResponseHeader(event, 'cache-control', 'private, no-store')
    const { code, state, error } = getQuery(event)
    if (error || typeof code !== 'string' || typeof state !== 'string') {
        return redirectToLogin({ event, error: 'sign_in_cancelled' })
    }

    const result = await completeGoogleSignIn({ event, code, state })
    if (!result) {
        return redirectToLogin({ event, error: 'sign_in_expired' })
    }

    const check = checkWorkspaceIdentity({ payload: result.payload, workspaceDomain: config.googleWorkspaceDomain })
    if (check.rejection) {
        console.info('[auth] sign-in rejected', check.rejection)
        return redirectToLogin({ event, error: 'wrong_account' })
    }

    const existing = await findUserByGoogleSub({ googleSub: check.identity.googleSub })
    if (existing?.deactivated_at) {
        return redirectToLogin({ event, error: 'deactivated' })
    }

    const user = await upsertGoogleUser({ ...check.identity, signedInAt: new Date() })
    await startSession({ event, userId: user.id })
    if (!existing) {
        await recordAudit({
            actor: { type: 'user', userId: user.id },
            action: 'user.created',
            entityType: 'user',
            entityId: user.id,
            changes: { email: user.email },
            ip: requestIp({ event }),
        })
    }
    return sendRedirect(event, result.redirectPath, 302)
})

/**
 * Send the browser back to the login page with an error code it can explain.
 *
 * @param input.event - The callback request.
 * @param input.error - Semantic error code shown by the login page.
 * @returns The redirect response.
 */
function redirectToLogin({ event, error }: { event: H3Event; error: string }) {
    return sendRedirect(event, `/login?error=${error}`, 302)
}
