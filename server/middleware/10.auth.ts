import { defineEventHandler, sendRedirect } from 'h3'
import { renderApiError } from '#server/utils/api.ts'
import { resolveAuth } from '#server/utils/auth.ts'
import { unauthorized } from '#server/utils/errors.ts'

// Non-/v1 paths that must never be reachable signed out. /v1 routes enforce auth themselves with
// requireUser, and pages are guarded by app/middleware/auth.global.ts.
const PROTECTED_PREFIXES = ['/_openapi.json', '/_scalar', '/admin/']

export default defineEventHandler(async event => {
    // Hashed build assets never need the session; skip the database lookup.
    if (event.path.startsWith('/_nuxt/')) {
        return
    }
    event.context.auth = await resolveAuth({ event })
    if (event.context.auth || !PROTECTED_PREFIXES.some(prefix => event.path.startsWith(prefix))) {
        return
    }
    if (event.path.startsWith('/_openapi.json')) {
        return renderApiError({ event, error: unauthorized() })
    }
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(event.path)}`, 302)
})
