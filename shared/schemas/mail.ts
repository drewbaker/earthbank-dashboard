import { z } from 'zod'
import { IsoDateTime, listOf, UserSummary } from '#shared/schemas/common.ts'

export const MailboxStatus = z.object({
    is_ai_configured: z.boolean(),
    is_inbound_configured: z.boolean(),
    connection: z
        .object({
            google_email: z.string(),
            status: z.enum(['active', 'error']),
            last_synced_at: IsoDateTime.nullable(),
            last_error: z.string().nullable(),
        })
        .nullable(),
    forwarding_address: z.string(),
})
export type MailboxStatus = z.infer<typeof MailboxStatus>

export const EmailEvidence = z.object({
    id: z.string(),
    source: z.enum(['gmail', 'forward']),
    from_address: z.string(),
    sent_at: IsoDateTime,
    /** Null when the AI marked the email sensitive. */
    subject: z.string().nullable(),
    summary: z.string(),
    is_relevant: z.boolean(),
    is_sensitive: z.boolean(),
    funder_id: z.string().nullable(),
    mailbox_user: UserSummary.nullable(),
})
export type EmailEvidence = z.infer<typeof EmailEvidence>

export const EmailEvidenceList = listOf(EmailEvidence)
export type EmailEvidenceList = z.infer<typeof EmailEvidenceList>

export const ActivitySummary = z.object({
    pending_changes: z.number().int(),
    draft_funders: z.number().int(),
})
export type ActivitySummary = z.infer<typeof ActivitySummary>
