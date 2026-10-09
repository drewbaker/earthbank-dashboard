import { defineEventHandler, getQuery, sendRedirect, setResponseHeader } from 'h3'
import { beginGoogleSignIn, safeRedirectPath } from '#server/utils/auth/google.ts'

// Starts "Sign in with Google". Not a /v1 route: it answers with a redirect, not JSON.
export default defineEventHandler(async event => {
    setResponseHeader(event, 'cache-control', 'private, no-store')
    const redirectPath = safeRedirectPath({ redirect: getQuery(event).redirect })
    const authorizationUrl = await beginGoogleSignIn({ event, redirectPath })
    return sendRedirect(event, authorizationUrl, 302)
})
