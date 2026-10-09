import { getRouterParam, sendStream, setResponseHeaders } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findAttachment } from '#server/database/attachments.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { fileExists, safeFilename, streamFile } from '#server/utils/storage.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Download an attachment',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'The file' } },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const attachment = await findAttachment({ attachmentId: getRouterParam(event, 'id') ?? '' })
    if (!attachment || !(await fileExists({ key: attachment.storage_key }))) {
        throw notFound({ resource: 'Attachment' })
    }
    // Always download (never render inline) so an uploaded HTML or SVG file can't run in our origin.
    setResponseHeaders(event, {
        'content-type': attachment.content_type,
        'content-length': attachment.size_bytes,
        'content-disposition': `attachment; filename="${safeFilename({ filename: attachment.filename })}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        'x-content-type-options': 'nosniff',
    })
    return sendStream(event, streamFile({ key: attachment.storage_key }))
})
