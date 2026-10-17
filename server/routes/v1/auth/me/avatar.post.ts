import { readMultipartFormData } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findUser, setUserAvatar } from '#server/database/users.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { detectAvatarFormat, MAX_AVATAR_BYTES } from '#server/utils/avatars.ts'
import { ApiError, badRequest, unauthorized } from '#server/utils/errors.ts'
import { serializeUser } from '#server/utils/serializers/users.ts'
import { deleteStoredFile, putFile } from '#server/utils/storage.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Auth'],
        summary: 'Upload your profile picture',
        description: 'multipart/form-data with one `file` field: a PNG, JPEG, GIF or WebP image up to 2 MB.',
        requestBody: {
            required: true,
            content: {
                'multipart/form-data': {
                    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
                },
            },
        },
        responses: {
            200: {
                description: 'You, with the new picture',
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
    const file = ((await readMultipartFormData(event)) ?? []).find(part => part.name === 'file' && part.filename)
    if (!file) {
        throw badRequest({ message: 'Choose a picture to upload.', code: 'missing_file' })
    }
    if (file.data.length > MAX_AVATAR_BYTES) {
        throw new ApiError({ status: 413, code: 'file_too_large', message: 'Pictures can be up to 2 MB.' })
    }
    const format = detectAvatarFormat({ data: file.data })
    if (!format) {
        throw badRequest({ message: 'Use a PNG, JPEG, GIF or WebP picture.', code: 'unsupported_image' })
    }
    const now = new Date()
    // A new key per upload, so the versioned URL changes and cached copies of the old one never show.
    const storageKey = `users/${user.id}/avatar-${now.getTime()}.${format.extension}`
    await putFile({ key: storageKey, data: file.data })
    const updated = await setUserAvatar({ userId: user.id, storageKey, updatedAt: now })
    if (user.avatar_storage_key) {
        await deleteStoredFile({ key: user.avatar_storage_key })
    }
    await recordAudit({
        actor: ctx.actor,
        action: 'user.avatar_uploaded',
        entityType: 'user',
        entityId: user.id,
        ip: requestIp({ event }),
    })
    return serializeUser({ user: updated })
})
