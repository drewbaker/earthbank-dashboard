import type { H3Event } from 'h3'
import { readMultipartFormData } from 'h3'
import { documentContentType } from '#server/utils/attachments/files.ts'
import { ApiError, badRequest } from '#server/utils/errors.ts'
import { MAX_ATTACHMENT_BYTES } from '#shared/constants/attachments.ts'

/**
 * The file in a multipart upload (one `file` field, up to 25 MB) and the other text fields.
 *
 * @param input.event - The request.
 * @returns The file's bytes, name and normalized type, and the text fields by name.
 * @throws ApiError 400 `missing_file` without a file; 413 `file_too_large` over 25 MB.
 */
export async function readUploadedFile({ event }: { event: H3Event }) {
    const parts = (await readMultipartFormData(event)) ?? []
    const file = parts.find(part => part.name === 'file' && part.filename)
    if (!file) {
        throw badRequest({ message: 'Choose a file to upload.', code: 'missing_file' })
    }
    if (file.data.length > MAX_ATTACHMENT_BYTES) {
        throw new ApiError({ status: 413, code: 'file_too_large', message: 'Files can be up to 25 MB.' })
    }
    const fields: Record<string, string> = {}
    for (const part of parts) {
        if (part.name && part.name !== 'file' && !part.filename) {
            fields[part.name] = part.data.toString('utf8')
        }
    }
    const filename = file.filename!.split(/[/\\]/).at(-1)!.slice(0, 200)
    return {
        data: new Uint8Array(file.data),
        filename,
        contentType: documentContentType({ filename, contentType: file.type ?? null }),
        fields,
    }
}
