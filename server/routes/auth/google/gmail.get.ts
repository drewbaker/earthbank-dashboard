import { defineEventHandler, sendRedirect, setResponseHeader } from 'h3'
import { beginGoogleSignIn } from '#server/utils/auth/google.ts'

// Starts "Connect Gmail" for the signed-in user: Google asks them to allow read-only mail access.
export default defineEventHandler(async event => {
    setResponseHeader(event, 'cache-control', 'private, no-store')
    const auth = event.context.auth
    if (!auth) {
        return sendRedirect(event, '/login?redirect=/settings/email', 302)
    }
    const authorizationUrl = await beginGoogleSignIn({
        event,
        redirectPath: '/settings/email',
        purpose: 'connect_gmail',
        loginHint: auth.user.email,
    })
    return sendRedirect(event, authorizationUrl, 302)
})
