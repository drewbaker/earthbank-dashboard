import { z } from 'zod'
import { IsoDateTime, listOf, UserSummary } from '#shared/schemas/common.ts'

export const MailboxSyncStatus = z.object({
    /** idle, queued (waiting for a worker), or running. */
    state: z.enum(['idle', 'queued', 'running']),
    /** While running: searching Gmail, checking which emails are funder mail, or reading them. */
    phase: z.enum(['searching', 'checking', 'reading']).nullable(),
    done: z.number().int(),
    total: z.number().int().nullable(),
    started_at: IsoDateTime.nullable(),
    /** What the last finished sync did. */
    last_result: z
        .object({
            matched: z.number().int(),
            processed: z.number().int(),
            applied: z.number().int(),
            pending: z.number().int(),
            finished_at: IsoDateTime,
        })
        .nullable(),
})
export type MailboxSyncStatus = z.infer<typeof MailboxSyncStatus>

export const MailboxStatus = z.object({
    is_ai_configured: z.boolean(),
    is_inbound_configured: z.boolean(),
    connection: z
        .object({
            google_email: z.string(),
            status: z.enum(['active', 'error']),
            last_synced_at: IsoDateTime.nullable(),
            last_error: z.string().nullable(),
            /** False for connections made before drafting existed; reconnecting grants it. */
            can_create_drafts: z.boolean(),
            sync: MailboxSyncStatus,
        })
        .nullable(),
    /** The shared address the team emails instructions and forwards to. */
    dashboard_address: z.string(),
})
export type MailboxStatus = z.infer<typeof MailboxStatus>

export const EmailEvidence = z.object({
    id: z.string(),
    source: z.enum(['gmail', 'forward']),
    /** Sent by Earth Bank, or received from the funder. */
    direction: z.enum(['sent', 'received']),
    from_address: z.string(),
    /** The other side: who it was sent to, or who sent it. */
    counterpart: z.string().nullable(),
    sent_at: IsoDateTime,
    /** Null when the AI marked the email sensitive. */
    subject: z.string().nullable(),
    summary: z.string(),
    is_relevant: z.boolean(),
    is_sensitive: z.boolean(),
    funder_id: z.string().nullable(),
    mailbox_user: UserSummary.nullable(),
    /** Pipeline changes this email caused (null where not loaded). */
    change_count: z.number().int().nullable(),
    /** Finds the email in Gmail; only for the person whose inbox it was read from, else null. */
    gmail_url: z.string().nullable(),
})
export type EmailEvidence = z.infer<typeof EmailEvidence>

export const EmailEvidenceList = listOf(EmailEvidence).extend({ total: z.number().int() })
export type EmailEvidenceList = z.infer<typeof EmailEvidenceList>

export const ActivitySummary = z.object({
    pending_changes: z.number().int(),
    draft_funders: z.number().int(),
})
export type ActivitySummary = z.infer<typeof ActivitySummary>

export const DraftReplyRequest = z.object({
    opportunity_id: z.string().nullable().optional(),
    guidance: z.string().trim().max(2000).nullable().optional(),
})
export type DraftReplyRequest = z.infer<typeof DraftReplyRequest>

const KnowledgeDocumentReference = z.object({ id: z.string(), name: z.string(), web_view_link: z.string().nullable() })

export const ReplyDraft = z.object({
    to: z.array(z.string()),
    cc: z.array(z.string()),
    subject: z.string(),
    body: z.string(),
    /** For the person sending: placeholders to fill, facts to check, files to attach. */
    notes: z.array(z.string()),
    thread: z
        .object({
            gmail_thread_id: z.string(),
            subject: z.string(),
            message_count: z.number().int(),
            last_message_at: IsoDateTime,
            last_message_from: z.string(),
            in_reply_to: z.string().nullable(),
            references: z.string().nullable(),
        })
        .nullable(),
    /** Documents the draft drew on. */
    documents: z.array(KnowledgeDocumentReference),
    /** Documents given to the AI (all of them, or the most relevant passages when there are many). */
    documents_considered: z.number().int(),
})
export type ReplyDraft = z.infer<typeof ReplyDraft>

const EmailAddressList = z.array(z.email('Enter valid email addresses.')).max(50)

export const CreateGmailDraftRequest = z.object({
    funder_id: z.string(),
    to: EmailAddressList.min(1, 'Add at least one recipient.'),
    cc: EmailAddressList.default([]),
    subject: z.string().trim().min(1, 'Add a subject.').max(500),
    body: z.string().trim().min(1, 'Write the email.').max(50000),
    gmail_thread_id: z.string().max(100).nullable().optional(),
    in_reply_to: z.string().max(1000).nullable().optional(),
    references: z.string().max(10000).nullable().optional(),
})
export type CreateGmailDraftRequest = z.infer<typeof CreateGmailDraftRequest>

export const GmailDraft = z.object({
    gmail_draft_id: z.string(),
    /** Opens the draft in Gmail. */
    open_url: z.string(),
})
export type GmailDraft = z.infer<typeof GmailDraft>
