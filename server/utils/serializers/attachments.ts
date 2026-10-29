import type { AttachmentRow } from '#server/database/attachments.ts'
import { toIsoDateTime } from '#server/utils/dates.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import type { AttachmentOrigin, AttachmentReadStatus } from '#shared/constants/attachments.ts'
import type { Attachment } from '#shared/schemas/index.ts'
import { AttachmentReadCounts } from '#shared/schemas/index.ts'

/**
 * Public shape of an attachment. The storage key and the email it came on stay internal; downloads go
 * through the API.
 *
 * @param input.attachment - The attachment with its uploader and ask.
 * @returns The API representation.
 */
export function serializeAttachment({ attachment }: { attachment: AttachmentRow }): Attachment {
    const counts = AttachmentReadCounts.safeParse(attachment.read_counts)
    return {
        id: attachment.id,
        task_id: attachment.task_id,
        comment_id: attachment.comment_id,
        funder_id: attachment.funder_id,
        opportunity: attachment.opportunity,
        fund_id: attachment.fund_manager_id,
        filename: attachment.filename,
        content_type: attachment.content_type,
        size_bytes: attachment.size_bytes,
        uploaded_by: serializeUserSummary({ user: attachment.uploaded_by }),
        origin: attachment.origin as AttachmentOrigin,
        read_status: attachment.read_status as AttachmentReadStatus | null,
        read_summary: attachment.read_summary,
        read_error: attachment.read_error,
        read_counts: counts.success ? counts.data : null,
        read_at: toIsoDateTime({ date: attachment.read_at }),
        download_url: attachmentDownloadPath({ attachmentId: attachment.id }),
        created_at: attachment.created_at.toISOString(),
    }
}

/**
 * Where a file downloads from (same-origin; the session cookie authorizes it).
 *
 * @param input.attachmentId - The file.
 * @returns The path.
 */
export function attachmentDownloadPath({ attachmentId }: { attachmentId: string }) {
    return `/v1/attachments/${attachmentId}/download`
}
