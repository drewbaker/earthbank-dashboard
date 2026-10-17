import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findUser } from '#server/database/users.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { badRequest, notFound } from '#server/utils/errors.ts'
import { sendInvitationEmail } from '#server/utils/sign-in-links.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Users'],
        summary: 'Resend a guest invitation',
        description:
            'Emails the guest a fresh sign-in link (valid for 7 days). Earlier links keep working until they expire.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Sent' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const user = await findUser({ userId: getRouterParam(event, 'id') ?? '' })
    if (!user) {
        throw notFound({ resource: 'User' })
    }
    if (user.google_sub) {
        throw badRequest({ message: `${user.name} signs in with Google.`, code: 'use_google_sign_in' })
    }
    if (user.deactivated_at) {
        throw badRequest({ message: `Reactivate ${user.name} first.`, code: 'user_deactivated' })
    }
    await sendInvitationEmail({ userId: user.id, email: user.email, inviterName: ctx.user.name })
    await recordAudit({
        actor: ctx.actor,
        action: 'user.invitation_resent',
        entityType: 'user',
        entityId: user.id,
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
