import { db } from '#server/utils/db.ts'

export const ATTACHMENT_INCLUDE = { uploaded_by: true } as const

/**
 * Record an uploaded file.
 *
 * @param input.attachmentId - Pre-generated id (it's part of the storage key).
 * @param input.taskId - The task.
 * @param input.uploadedById - Who uploaded it.
 * @param input.filename - Original file name.
 * @param input.contentType - MIME type.
 * @param input.sizeBytes - Size.
 * @param input.storageKey - Where the bytes live.
 * @returns The attachment with its uploader.
 */
export function createAttachmentRow({
    attachmentId,
    taskId,
    uploadedById,
    filename,
    contentType,
    sizeBytes,
    storageKey,
}: {
    attachmentId: string
    taskId: string
    uploadedById: string
    filename: string
    contentType: string
    sizeBytes: number
    storageKey: string
}) {
    return db().attachment.create({
        data: {
            id: attachmentId,
            task_id: taskId,
            uploaded_by_id: uploadedById,
            filename,
            content_type: contentType,
            size_bytes: sizeBytes,
            storage_key: storageKey,
        },
        include: ATTACHMENT_INCLUDE,
    })
}

/**
 * Find a live attachment.
 *
 * @param input.attachmentId - The attachment.
 * @returns The attachment with its uploader, or null.
 */
export function findAttachment({ attachmentId }: { attachmentId: string }) {
    return db().attachment.findFirst({ where: { id: attachmentId, deleted_at: null }, include: ATTACHMENT_INCLUDE })
}

/**
 * A task's live attachments, oldest first.
 *
 * @param input.taskId - The task.
 * @returns Attachments with uploaders.
 */
export function listTaskAttachments({ taskId }: { taskId: string }) {
    return db().attachment.findMany({
        where: { task_id: taskId, deleted_at: null },
        include: ATTACHMENT_INCLUDE,
        orderBy: { id: 'asc' },
    })
}

/**
 * Soft-delete an attachment; the cleanup task removes the file later.
 *
 * @param input.attachmentId - The attachment.
 * @param input.deletedAt - When.
 * @returns The updated row.
 */
export function markAttachmentDeleted({ attachmentId, deletedAt }: { attachmentId: string; deletedAt: Date }) {
    return db().attachment.update({ where: { id: attachmentId }, data: { deleted_at: deletedAt } })
}

/**
 * Attachments deleted before a cutoff whose files can now be removed.
 *
 * @param input.deletedBefore - Retention cutoff.
 * @returns Rows with id and storage key.
 */
export function listPurgeableAttachments({ deletedBefore }: { deletedBefore: Date }) {
    return db().attachment.findMany({
        where: { deleted_at: { lt: deletedBefore } },
        select: { id: true, storage_key: true },
    })
}

/**
 * Permanently remove attachment rows (after their files are gone).
 *
 * @param input.attachmentIds - Rows to remove.
 * @returns The number removed.
 */
export async function deleteAttachmentRows({ attachmentIds }: { attachmentIds: string[] }) {
    const result = await db().attachment.deleteMany({ where: { id: { in: attachmentIds } } })
    return result.count
}
