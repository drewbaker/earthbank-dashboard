import { defineEventHandler, getRequestHeader } from 'h3'
import { renderApiError } from '#server/utils/api.ts'
import { ApiError } from '#server/utils/errors.ts'

// Attachments (Phase 3) are the largest legitimate bodies; everything else is small JSON.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const MAX_JSON_BYTES = 1024 * 1024

export default defineEventHandler(event => {
    const contentLength = Number(getRequestHeader(event, 'content-length') ?? 0)
    const isUpload = getRequestHeader(event, 'content-type')?.startsWith('multipart/form-data') ?? false
    const limit = isUpload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES
    if (contentLength > limit) {
        return renderApiError({
            event,
            error: new ApiError({ status: 413, code: 'payload_too_large', message: 'The request body is too large.' }),
        })
    }
})
