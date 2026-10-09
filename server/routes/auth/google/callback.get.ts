import type { H3Event } from 'h3'
import { defineEventHandler, getQuery, sendRedirect, setResponseHeader } from 'h3'
import { upsertKnowledgeSource } from '#server/database/knowledge.ts'
import { upsertMailboxConnection } from '#server/database/mailboxes.ts'
import { findUserByGoogleSub, upsertGoogleUser } from '#server/database/users.ts'
import { requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { startSession } from '#server/utils/auth.ts'
import { checkWorkspaceIdentity, completeGoogleSignIn, hasGoogleScope } from '#server/utils/auth/google.ts'
import { config } from '#server/utils/config.ts'
import { encryptSecret } from '#server/utils/crypto.ts'
import { enqueueKnowledgeSync, enqueueMailboxSync } from '#server/utils/jobs/enqueue.ts'
import { GoogleKnowledgeDrive } from '#server/utils/knowledge/drive.ts'

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

    if (result.purpose === 'connect_gmail') {
        return connectGmail({ event, googleSub: check.identity.googleSub, email: check.identity.email, ...result })
    }
    if (result.purpose === 'connect_drive') {
        return connectDriveFolder({ event, googleSub: check.identity.googleSub, ...result })
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

/**
 * Finish "Connect Gmail": the Google account must be the signed-in user's own, and Google must have
 * granted read-only mail access with a refresh token. Then queue a first sync.
 *
 * @param input.event - The callback request.
 * @param input.googleSub - Google subject of the account that consented.
 * @param input.email - Its verified email.
 * @param input.refreshToken - Refresh token from Google (needed for background sync).
 * @param input.grantedScopes - Scopes Google granted.
 * @param input.redirectPath - Where to send the browser afterwards.
 * @returns The redirect response.
 */
async function connectGmail({
    event,
    googleSub,
    email,
    refreshToken,
    grantedScopes,
    redirectPath,
}: {
    event: H3Event
    googleSub: string
    email: string
    refreshToken: string | null
    grantedScopes: string
    redirectPath: string
}) {
    const auth = event.context.auth
    const user = await findUserByGoogleSub({ googleSub })
    if (!auth || !user || user.id !== auth.user.id) {
        return sendRedirect(event, `${redirectPath}?gmail=wrong_account`, 302)
    }
    if (!refreshToken || !hasGoogleScope({ grantedScopes, scope: 'gmail.readonly' })) {
        return sendRedirect(event, `${redirectPath}?gmail=not_granted`, 302)
    }
    const connection = await upsertMailboxConnection({
        userId: user.id,
        googleEmail: email,
        refreshTokenEncrypted: encryptSecret({ plaintext: refreshToken }),
        scopes: grantedScopes,
    })
    await recordAudit({
        actor: { type: 'user', userId: user.id },
        action: 'mailbox.connected',
        entityType: 'mailbox_connection',
        entityId: connection.id,
        ip: requestIp({ event }),
    })
    await enqueueMailboxSync({ mailboxConnectionId: connection.id })
    return sendRedirect(event, `${redirectPath}?gmail=connected`, 302)
}

/**
 * Finish "Connect a Drive folder": the Google account must be the signed-in user's own, Google must
 * have granted read-only Drive access with a refresh token, and the folder must be one they can read.
 * Then save it as a knowledge source and queue its first sync.
 *
 * @param input.event - The callback request.
 * @param input.googleSub - Google subject of the account that consented.
 * @param input.driveFolderId - The folder chosen before the redirect.
 * @param input.refreshToken - Refresh token from Google.
 * @param input.grantedScopes - Scopes Google granted.
 * @param input.redirectPath - Where to send the browser afterwards.
 * @returns The redirect response.
 */
async function connectDriveFolder({
    event,
    googleSub,
    driveFolderId,
    refreshToken,
    grantedScopes,
    redirectPath,
}: {
    event: H3Event
    googleSub: string
    driveFolderId: string | null
    refreshToken: string | null
    grantedScopes: string
    redirectPath: string
}) {
    const auth = event.context.auth
    const user = await findUserByGoogleSub({ googleSub })
    if (!auth || !user || user.id !== auth.user.id) {
        return sendRedirect(event, `${redirectPath}?drive=wrong_account`, 302)
    }
    if (!driveFolderId || !refreshToken || !hasGoogleScope({ grantedScopes, scope: 'drive.readonly' })) {
        return sendRedirect(event, `${redirectPath}?drive=not_granted`, 302)
    }
    const folder = await new GoogleKnowledgeDrive({ refreshToken }).getFolder({ folderId: driveFolderId })
    if (!folder) {
        return sendRedirect(event, `${redirectPath}?drive=folder_not_found`, 302)
    }
    const source = await upsertKnowledgeSource({
        driveFolderId: folder.id,
        name: folder.name,
        connectedById: user.id,
        refreshTokenEncrypted: encryptSecret({ plaintext: refreshToken }),
    })
    await recordAudit({
        actor: { type: 'user', userId: user.id },
        action: 'knowledge_source.connected',
        entityType: 'knowledge_source',
        entityId: source.id,
        changes: { name: folder.name },
        ip: requestIp({ event }),
    })
    await enqueueKnowledgeSync({ knowledgeSourceId: source.id })
    return sendRedirect(event, `${redirectPath}?drive=connected`, 302)
}
