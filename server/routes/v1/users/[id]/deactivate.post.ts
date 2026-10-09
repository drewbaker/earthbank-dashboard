import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { deactivateUser, findUser } from '#server/database/users.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { badRequest, notFound } from '#server/utils/errors.ts'
import { serializeUser } from '#server/utils/serializers/users.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Users'],
        summary: 'Deactivate a team member',
        description: 'Signs them out everywhere and blocks future sign-ins. Also remove them in Google Workspace.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The deactivated user',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const userId = getRouterParam(event, 'id') ?? ''
    if (userId === ctx.user.id) {
        throw badRequest({ message: 'You cannot deactivate yourself.', code: 'cannot_deactivate_self' })
    }
    const existing = await findUser({ userId })
    if (!existing) {
        throw notFound({ resource: 'User' })
    }
    const user = await deactivateUser({ userId, deactivatedAt: new Date() })
    await recordAudit({
        actor: ctx.actor,
        action: 'user.deactivated',
        entityType: 'user',
        entityId: userId,
        ip: requestIp({ event }),
    })
    return serializeUser({ user })
})
