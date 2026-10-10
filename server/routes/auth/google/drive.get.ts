import { defineEventHandler, getQuery, sendRedirect, setResponseHeader } from 'h3'
import { beginGoogleSignIn } from '#server/utils/auth/google.ts'
import { parseDriveItemId } from '#server/utils/knowledge/drive.ts'

// Starts "Connect a Drive folder or file" for the signed-in user: Google asks them to allow read-only
// Drive access, then the callback checks the item and adds it as a knowledge source.
export default defineEventHandler(async event => {
    setResponseHeader(event, 'cache-control', 'private, no-store')
    const auth = event.context.auth
    if (!auth) {
        return sendRedirect(event, '/login?redirect=/settings/knowledge', 302)
    }
    // `folder` is the older query name; links from before files were supported still use it.
    const { item, folder } = getQuery(event)
    const pasted = typeof item === 'string' ? item : folder
    const driveItemId = typeof pasted === 'string' ? parseDriveItemId({ value: pasted }) : null
    if (!driveItemId) {
        return sendRedirect(event, '/settings/knowledge?drive=invalid_link', 302)
    }
    const authorizationUrl = await beginGoogleSignIn({
        event,
        redirectPath: '/settings/knowledge',
        purpose: 'connect_drive',
        loginHint: auth.user.email,
        driveItemId,
    })
    return sendRedirect(event, authorizationUrl, 302)
})
