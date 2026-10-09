import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { endSession } from '#server/utils/auth.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Auth'],
        summary: 'Sign out',
        responses: {
            204: { description: 'Signed out' },
        },
    },
})

// Works signed out too (signing out twice is harmless); only a real sign-out is audited.
export default defineApiHandler(async event => {
    const auth = event.context.auth
    await endSession({ event })
    if (auth) {
        await recordAudit({
            actor: auth.actor,
            action: 'user.signed_out',
            entityType: 'user',
            entityId: auth.user.id,
            ip: requestIp({ event }),
        })
    }
    setResponseStatus(event, 204)
    return null
})
