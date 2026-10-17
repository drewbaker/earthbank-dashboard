import { getRouterParam, sendStream, setResponseHeaders } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findUser } from '#server/database/users.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { avatarContentType } from '#server/utils/avatars.ts'
import { notFound } from '#server/utils/errors.ts'
import { fileExists, streamFile } from '#server/utils/storage.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Users'],
        summary: "A team member's uploaded profile picture",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'The picture' } },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const user = await findUser({ userId: getRouterParam(event, 'id') ?? '' })
    const storageKey = user?.avatar_storage_key
    const contentType = storageKey ? avatarContentType({ storageKey }) : null
    if (!storageKey || !contentType || !(await fileExists({ key: storageKey }))) {
        throw notFound({ resource: 'Picture' })
    }
    setResponseHeaders(event, {
        'content-type': contentType,
        // The URL carries the upload time (?v=…), so a browser can keep it until the picture changes.
        // Private: only signed-in people may see it, so the CDN never stores it.
        'cache-control': 'private, max-age=31536000, immutable',
        'content-security-policy': "default-src 'none'",
        'x-content-type-options': 'nosniff',
    })
    return sendStream(event, streamFile({ key: storageKey }))
})
