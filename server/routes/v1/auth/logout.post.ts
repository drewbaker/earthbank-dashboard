import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
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

export default defineApiHandler(async event => {
    await endSession({ event })
    setResponseStatus(event, 204)
    return null
})
