import { defineEventHandler, getRequestHeader } from 'h3'
import { renderApiError } from '#server/utils/api.ts'
import { ApiError } from '#server/utils/errors.ts'

// Attachments are the largest legitimate bodies; everything else is small JSON.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const MAX_JSON_BYTES = 1024 * 1024
const METHODS_WITH_BODIES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// The limit is checked from Content-Length before anything reads the body. A body sent without a
// length (chunked) can't be checked up front, so it's refused: browsers, fetch and Resend's webhooks
// always send a length.
export default defineEventHandler(event => {
    if (!METHODS_WITH_BODIES.has(event.method)) {
        return
    }
    const lengthHeader = getRequestHeader(event, 'content-length')
    const isChunked = /chunked/i.test(getRequestHeader(event, 'transfer-encoding') ?? '')
    if (isChunked && !lengthHeader) {
        return renderApiError({
            event,
            error: new ApiError({ status: 411, code: 'length_required', message: 'Send a Content-Length header.' }),
        })
    }
    const isUpload = getRequestHeader(event, 'content-type')?.startsWith('multipart/form-data') ?? false
    if (Number(lengthHeader ?? 0) > (isUpload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES)) {
        return renderApiError({
            event,
            error: new ApiError({ status: 413, code: 'payload_too_large', message: 'The request body is too large.' }),
        })
    }
})
