import type { AttachmentTarget } from '#server/database/attachments.ts'
import { createAttachmentRow, updateAttachmentRead } from '#server/database/attachments.ts'
import { newId } from '#server/utils/ids.ts'
import { enqueueAttachmentRead } from '#server/utils/jobs/enqueue.ts'
import { contentPlan } from '#server/utils/knowledge/extract.ts'
import { putFile, safeFilename } from '#server/utils/storage.ts'
import type { AttachmentOrigin } from '#shared/constants/attachments.ts'

// Mail clients and browsers often send documents as application/octet-stream; the extension decides then.
const TYPES_BY_EXTENSION: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
}

/** Shown on funder and fund files the AI can't read. */
export const UNREADABLE_FILE_SUMMARY =
    "Stored, but not read: the AI reads PDFs and Word, Excel, PowerPoint and text files (it can't read images)."

/**
 * The MIME type to treat a file as: the one it came with, unless that's generic and the extension
 * says more.
 *
 * @param input.filename - The file's name.
 * @param input.contentType - The type it was sent with, if any.
 * @returns A MIME type.
 */
export function documentContentType({ filename, contentType }: { filename: string; contentType: string | null }) {
    const declared = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
    const extension = filename.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? ''
    const byExtension = TYPES_BY_EXTENSION[extension]
    if (byExtension && (!declared || declared === 'application/octet-stream' || !isReadableType({ type: declared }))) {
        return byExtension
    }
    return declared || 'application/octet-stream'
}

/**
 * Whether the AI can read a file of this type (PDF, Word, Excel, PowerPoint, plain text).
 *
 * @param input.type - MIME type.
 * @returns True when its text can be extracted.
 */
export function isReadableType({ type }: { type: string }) {
    return contentPlan({ mimeType: type })?.action === 'download'
}

/**
 * Store a file for a task, funder or fund. Funder and fund files the AI can read are queued for
 * reading; others are kept and marked not read.
 *
 * @param input.target - What it's attached to.
 * @param input.data - The file's bytes.
 * @param input.filename - Its name as uploaded or sent.
 * @param input.contentType - Its type, already normalized with `documentContentType`.
 * @param input.uploadedById - Who uploaded it (or sent the email it came on).
 * @param input.origin - `upload` or `email`.
 * @param input.receivedEmailId - Resend's id for the email it came on.
 * @param input.createdAt - When it arrived (an emailed file keeps the email's time); defaults to now.
 * @returns The attachment row.
 */
export async function storeAttachment({
    target,
    data,
    filename,
    contentType,
    uploadedById,
    origin = 'upload',
    receivedEmailId = null,
    createdAt,
}: {
    target: AttachmentTarget
    data: Uint8Array
    filename: string
    contentType: string
    uploadedById: string | null
    origin?: AttachmentOrigin
    receivedEmailId?: string | null
    createdAt?: Date
}) {
    const attachmentId = newId({ kind: 'attachment' })
    const storageKey = `${storageFolder({ target })}/${attachmentId}/${safeFilename({ filename })}`
    await putFile({ key: storageKey, data })
    const isReadByAi = target.kind !== 'task'
    const isReadable = isReadableType({ type: contentType })
    const attachment = await createAttachmentRow({
        attachmentId,
        target,
        uploadedById,
        filename: filename.split(/[/\\]/).at(-1)!.slice(0, 200) || 'file',
        contentType,
        sizeBytes: data.length,
        storageKey,
        origin,
        receivedEmailId,
        readStatus: isReadByAi ? (isReadable ? 'queued' : 'skipped') : null,
        createdAt,
    })
    if (isReadByAi && !isReadable) {
        return updateAttachmentRead({
            attachmentId,
            data: { read_status: 'skipped', read_summary: UNREADABLE_FILE_SUMMARY, read_at: new Date() },
        })
    }
    if (isReadByAi) {
        await enqueueAttachmentRead({ attachmentId })
    }
    return attachment
}

/**
 * The storage folder for a target's files, e.g. `funds/fmg_…`.
 *
 * @param input.target - What the file is attached to.
 * @returns A relative key prefix.
 */
function storageFolder({ target }: { target: AttachmentTarget }) {
    if (target.kind === 'task') {
        return `tasks/${target.taskId}`
    }
    return target.kind === 'funder' ? `funders/${target.funderId}` : `funds/${target.fundManagerId}`
}
