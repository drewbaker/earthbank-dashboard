import type { H3Event } from 'h3'
import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { createInvitedUser, findUserByEmail } from '#server/database/users.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import type { AuthActor } from '#server/utils/auth.ts'
import { requireUser } from '#server/utils/auth.ts'
import { badRequest, conflict } from '#server/utils/errors.ts'
import { serializeUser } from '#server/utils/serializers/users.ts'
import { isWorkspaceEmail, sendInvitationEmail } from '#server/utils/sign-in-links.ts'
import { InviteUserRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Users'],
        summary: 'Invite a guest',
        description:
            "Gives someone outside the Earth Bank Workspace access and emails them a sign-in link. They sign in with emailed links from then on. Earth Bank staff don't need an invite: they sign in with Google.",
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/InviteUserRequest' } } },
        },
        responses: {
            201: {
                description: 'Invited',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const { name, email } = await parseBody({ event, schema: InviteUserRequest })
    if (isWorkspaceEmail({ email })) {
        throw badRequest({
            message: "Earth Bank staff don't need an invite: they sign in with Google.",
            code: 'use_google_sign_in',
        })
    }
    const existing = await findUserByEmail({ email })
    if (existing) {
        throw conflict({
            message: existing.deactivated_at
                ? `${existing.name} already has an account that's deactivated. Reactivate it instead.`
                : `${existing.name} already has access.`,
        })
    }
    const user = await createInvitedUser({ email, name, invitedById: ctx.user.id, invitedAt: new Date() })
    await sendInvitationEmail({ userId: user.id, email, inviterName: ctx.user.name })
    await auditInvitation({ event, actor: ctx.actor, userId: user.id, email })
    setResponseStatus(event, 201)
    return serializeUser({ user })
})

/**
 * Record the invitation in the audit log.
 *
 * @param input.event - The request, for the caller's IP.
 * @param input.actor - Who invited them.
 * @param input.userId - The new guest's id.
 * @param input.email - Their address.
 * @returns Resolves once the entry is written.
 */
async function auditInvitation({
    event,
    actor,
    userId,
    email,
}: {
    event: H3Event
    actor: AuthActor
    userId: string
    email: string
}) {
    await recordAudit({
        actor,
        action: 'user.invited',
        entityType: 'user',
        entityId: userId,
        changes: { email },
        ip: requestIp({ event }),
    })
}
