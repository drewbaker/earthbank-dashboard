import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findUser, reactivateUser } from '#server/database/users.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeUser } from '#server/utils/serializers/users.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Users'],
        summary: 'Reactivate a team member',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The reactivated user',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const userId = getRouterParam(event, 'id') ?? ''
    if (!(await findUser({ userId }))) {
        throw notFound({ resource: 'User' })
    }
    const user = await reactivateUser({ userId })
    await recordAudit({
        actor: ctx.actor,
        action: 'user.reactivated',
        entityType: 'user',
        entityId: userId,
        ip: requestIp({ event }),
    })
    return serializeUser({ user })
})
