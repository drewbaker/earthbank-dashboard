import { defineRouteMeta } from 'nitropack/runtime'
import { consumeSignInLink } from '#server/database/sign-in-links.ts'
import { recordUserSignIn } from '#server/database/users.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { startSession } from '#server/utils/auth.ts'
import { safeRedirectPath } from '#server/utils/auth/google.ts'
import { hashToken } from '#server/utils/crypto.ts'
import { badRequest } from '#server/utils/errors.ts'
import { RedeemSignInLinkRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Auth'],
        summary: 'Sign in with an emailed link (public)',
        description:
            'Uses up the link and starts a session. The link page posts here when the person clicks Sign in, so mail scanners that open links can never use one up.',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RedeemSignInLinkRequest' } } },
        },
        responses: {
            200: {
                description: 'Signed in',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/SignInLinkRedeemed' } } },
            },
            400: { description: 'The link was used, has expired, or the account is deactivated' },
        },
    },
})

export default defineApiHandler(async event => {
    const { token, redirect } = await parseBody({ event, schema: RedeemSignInLinkRequest })
    const now = new Date()
    const link = await consumeSignInLink({ tokenHash: hashToken({ token }), now })
    if (!link) {
        throw badRequest({
            message: 'This sign-in link has already been used or has expired. Ask for a new one below.',
            code: 'sign_in_link_invalid',
        })
    }
    await startSession({ event, userId: link.user_id, now })
    await recordUserSignIn({ userId: link.user_id, signedInAt: now })
    await recordAudit({
        actor: { type: 'user', userId: link.user_id },
        action: link.purpose === 'invitation' ? 'user.invitation_accepted' : 'user.signed_in_with_link',
        entityType: 'user',
        entityId: link.user_id,
        ip: requestIp({ event }),
    })
    return { redirect: safeRedirectPath({ redirect }) }
})
