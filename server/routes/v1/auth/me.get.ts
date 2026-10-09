import { defineRouteMeta } from 'nitropack/runtime'
import { findUser } from '#server/database/users.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { unauthorized } from '#server/utils/errors.ts'
import { serializeUser } from '#server/utils/serializers/users.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Auth'],
        summary: 'Get the signed-in user',
        responses: {
            200: {
                description: 'The signed-in user',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/CurrentUser' } } },
            },
            401: {
                description: 'Signed out',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const user = await findUser({ userId: ctx.user.id })
    if (!user) {
        throw unauthorized()
    }
    return { user: serializeUser({ user }) }
})
