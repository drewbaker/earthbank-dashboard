import { defineEventHandler, getQuery, sendRedirect, setResponseHeader } from 'h3'
import { beginGoogleSignIn } from '#server/utils/auth/google.ts'
import { parseDriveFolderId } from '#server/utils/knowledge/drive.ts'

// Starts "Connect a Drive folder" for the signed-in user: Google asks them to allow read-only Drive
// access, then the callback checks the folder and adds it as a knowledge source.
export default defineEventHandler(async event => {
    setResponseHeader(event, 'cache-control', 'private, no-store')
    const auth = event.context.auth
    if (!auth) {
        return sendRedirect(event, '/login?redirect=/settings/knowledge', 302)
    }
    const { folder } = getQuery(event)
    const driveFolderId = typeof folder === 'string' ? parseDriveFolderId({ value: folder }) : null
    if (!driveFolderId) {
        return sendRedirect(event, '/settings/knowledge?drive=invalid_folder', 302)
    }
    const authorizationUrl = await beginGoogleSignIn({
        event,
        redirectPath: '/settings/knowledge',
        purpose: 'connect_drive',
        loginHint: auth.user.email,
        driveFolderId,
    })
    return sendRedirect(event, authorizationUrl, 302)
})
