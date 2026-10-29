import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import type { AttachmentOrigin, AttachmentReadStatus } from '#shared/constants/attachments.ts'

export const ATTACHMENT_INCLUDE = {
    uploaded_by: true,
    opportunity: { select: { id: true, name: true } },
} satisfies Prisma.AttachmentInclude

export type AttachmentRow = Prisma.AttachmentGetPayload<{ include: typeof ATTACHMENT_INCLUDE }>

/** What a file is attached to: a task (or one of its comments), a funder (and maybe one of its asks), or a fund. */
export type AttachmentTarget =
    | { kind: 'task'; taskId: string; commentId?: string | null }
    | { kind: 'funder'; funderId: string; opportunityId?: string | null }
    | { kind: 'fund'; fundManagerId: string }

/**
 * Record a stored file.
 *
 * @param input.attachmentId - Pre-generated id (it's part of the storage key).
 * @param input.target - What it's attached to.
 * @param input.uploadedById - Who uploaded it (or sent the email it came on).
 * @param input.filename - Original file name.
 * @param input.contentType - MIME type.
 * @param input.sizeBytes - Size.
 * @param input.storageKey - Where the bytes live.
 * @param input.origin - `upload` (default) or `email`.
 * @param input.receivedEmailId - Resend's id for the email it came on.
 * @param input.readStatus - `queued` when the AI will read it; null for task files.
 * @param input.createdAt - When; defaults to now (emailed files keep the email's time).
 * @returns The attachment with its uploader.
 */
export function createAttachmentRow({
    attachmentId,
    target,
    uploadedById,
    filename,
    contentType,
    sizeBytes,
    storageKey,
    origin = 'upload',
    receivedEmailId = null,
    readStatus = null,
    createdAt,
}: {
    attachmentId: string
    target: AttachmentTarget
    uploadedById: string | null
    filename: string
    contentType: string
    sizeBytes: number
    storageKey: string
    origin?: AttachmentOrigin
    receivedEmailId?: string | null
    readStatus?: AttachmentReadStatus | null
    createdAt?: Date
}) {
    return db().attachment.create({
        data: {
            id: attachmentId,
            task_id: target.kind === 'task' ? target.taskId : null,
            comment_id: target.kind === 'task' ? (target.commentId ?? null) : null,
            funder_id: target.kind === 'funder' ? target.funderId : null,
            opportunity_id: target.kind === 'funder' ? (target.opportunityId ?? null) : null,
            fund_manager_id: target.kind === 'fund' ? target.fundManagerId : null,
            uploaded_by_id: uploadedById,
            filename,
            content_type: contentType,
            size_bytes: sizeBytes,
            storage_key: storageKey,
            origin,
            received_email_id: receivedEmailId,
            read_status: readStatus,
            ...(createdAt ? { created_at: createdAt } : {}),
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
 * A funder's or a fund's live files, newest first.
 *
 * @param input.funderId - The funder, or
 * @param input.fundManagerId - the fund.
 * @returns Attachments with uploaders.
 */
export function listOwnerAttachments({ funderId, fundManagerId }: { funderId?: string; fundManagerId?: string }) {
    return db().attachment.findMany({
        where: {
            deleted_at: null,
            ...(funderId ? { funder_id: funderId } : { fund_manager_id: fundManagerId ?? '' }),
        },
        include: ATTACHMENT_INCLUDE,
        orderBy: { id: 'desc' },
    })
}

/**
 * Record how the AI reading of a file is going or went.
 *
 * @param input.attachmentId - The file.
 * @param input.data - Status, summary, counts and any error.
 * @returns The updated attachment.
 */
export function updateAttachmentRead({
    attachmentId,
    data,
}: {
    attachmentId: string
    data: {
        read_status: AttachmentReadStatus
        read_summary?: string | null
        read_error?: string | null
        read_counts?: Prisma.InputJsonValue
        read_at?: Date | null
        opportunity_id?: string | null
    }
}) {
    return db().attachment.update({ where: { id: attachmentId }, data, include: ATTACHMENT_INCLUDE })
}

/**
 * Files waiting to be read (or interrupted while being read), for re-queueing after a restart.
 *
 * @returns Ids of files still queued or reading.
 */
export async function listUnreadAttachmentIds() {
    const rows = await db().attachment.findMany({
        where: { deleted_at: null, read_status: { in: ['queued', 'reading'] } },
        select: { id: true },
    })
    return rows.map(row => row.id)
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

/**
 * Soft-delete the files attached to a comment (when the comment is deleted).
 *
 * @param input.commentId - The comment.
 * @param input.deletedAt - When.
 * @returns The number marked deleted.
 */
export async function markCommentAttachmentsDeleted({ commentId, deletedAt }: { commentId: string; deletedAt: Date }) {
    const result = await db().attachment.updateMany({
        where: { comment_id: commentId, deleted_at: null },
        data: { deleted_at: deletedAt },
    })
    return result.count
}
