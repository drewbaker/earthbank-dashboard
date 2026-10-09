import { defineRouteMeta } from 'nitropack/runtime'
import { listUsers } from '#server/database/users.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeUser } from '#server/utils/serializers/users.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Users'],
        summary: 'List team members',
        responses: {
            200: {
                description: 'Every user, active first',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/UserList' } } },
            },
        },
    },
})

// The team is small, so this returns everyone in one page.
export default defineApiHandler(async event => {
    requireUser({ event })
    const users = await listUsers()
    return { data: users.map(user => serializeUser({ user })), next_cursor: null, has_more: false }
})
