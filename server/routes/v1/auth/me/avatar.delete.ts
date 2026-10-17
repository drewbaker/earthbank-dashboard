import { defineRouteMeta } from 'nitropack/runtime'
import { findUser, setUserAvatar } from '#server/database/users.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { unauthorized } from '#server/utils/errors.ts'
import { serializeUser } from '#server/utils/serializers/users.ts'
import { deleteStoredFile } from '#server/utils/storage.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Auth'],
        summary: 'Remove your uploaded profile picture',
        description: 'Goes back to your Google profile picture, or initials when there is none.',
        responses: {
            200: {
                description: 'You, without the uploaded picture',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
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
    if (!user.avatar_storage_key) {
        return serializeUser({ user })
    }
    const updated = await setUserAvatar({ userId: user.id, storageKey: null, updatedAt: new Date() })
    await deleteStoredFile({ key: user.avatar_storage_key })
    await recordAudit({
        actor: ctx.actor,
        action: 'user.avatar_removed',
        entityType: 'user',
        entityId: user.id,
        ip: requestIp({ event }),
    })
    return serializeUser({ user: updated })
})
