import { z } from 'zod'
import { ATTACHMENT_ORIGINS, ATTACHMENT_READ_STATUSES } from '#shared/constants/attachments.ts'
import { IsoDateTime, UserSummary } from '#shared/schemas/common.ts'

// What the AI took from a funder or fund file. Fund files fill research and diligence; funder files
// update the pipeline (applied, or waiting on Activity) and add contacts.
export const AttachmentReadCounts = z.object({
    facts: z.number().int(),
    people: z.number().int(),
    diligence: z.number().int(),
    applied: z.number().int(),
    pending: z.number().int(),
    contacts: z.number().int(),
})
export type AttachmentReadCounts = z.infer<typeof AttachmentReadCounts>

export const Attachment = z.object({
    id: z.string(),
    /** Exactly one of task_id, funder_id and fund_id is set. */
    task_id: z.string().nullable(),
    /** Set when the file belongs to a comment rather than the task. */
    comment_id: z.string().nullable(),
    funder_id: z.string().nullable(),
    /** The ask a funder file is about, when known. */
    opportunity: z.object({ id: z.string(), name: z.string() }).nullable(),
    fund_id: z.string().nullable(),
    filename: z.string(),
    content_type: z.string(),
    size_bytes: z.number().int(),
    uploaded_by: UserSummary.nullable(),
    origin: z.enum(ATTACHMENT_ORIGINS),
    /** Null for task files, which the AI doesn't read. */
    read_status: z.enum(ATTACHMENT_READ_STATUSES).nullable(),
    read_summary: z.string().nullable(),
    read_error: z.string().nullable(),
    read_counts: AttachmentReadCounts.nullable(),
    read_at: IsoDateTime.nullable(),
    download_url: z.string(),
    created_at: IsoDateTime,
})
export type Attachment = z.infer<typeof Attachment>

export const AttachmentList = z.object({ data: z.array(Attachment) })
export type AttachmentList = z.infer<typeof AttachmentList>
