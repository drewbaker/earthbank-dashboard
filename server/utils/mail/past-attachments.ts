import { Resend } from 'resend'
import { hasAuditEntry } from '#server/database/audit-logs.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { config } from '#server/utils/config.ts'
import type { DownloadEmailAttachment } from '#server/utils/mail/email-files.ts'
import type { ReceivedEmail } from '#server/utils/mail/inbound.ts'
import { EMAIL_FILES_AUDIT_ACTION, filePastEmailFiles } from '#server/utils/mail/inbound.ts'

/** One email sent to the dashboard, as Resend lists it (no body). */
export type ListedReceivedEmail = { id: string; createdAt: string; attachmentCount: number }

/** Lists received emails a page at a time, newest first (Resend by default; tests pass a fake). */
export type ListReceivedEmails = (input: {
    after: string | null
}) => Promise<{ emails: ListedReceivedEmail[]; hasMore: boolean }>

// A new email is handled by its webhook within a minute or two; the pass leaves recent ones to it, so
// an email with instructions isn't filed here before its instructions are carried out.
const WEBHOOK_GRACE_MS = 60 * 60 * 1000

/**
 * File the attachments of every email sent to the dashboard address that hasn't had them filed:
 * emails from before the dashboard read attachments, and any whose webhook was lost. Emails whose
 * attachments were already handled are skipped, so the pass can run after every deploy.
 *
 * @param input.ai - The AI provider.
 * @param input.today - Today's date for the team (YYYY-MM-DD).
 * @param input.now - The current time.
 * @param input.listReceivedEmails - Lists received emails (Resend by default).
 * @param input.fetchReceivedEmail - Loads one email (Resend by default).
 * @param input.downloadAttachment - Downloads an attachment (Resend by default).
 * @returns How many emails were looked at and how many files were filed.
 */
export async function filePastEmailAttachments({
    ai,
    today,
    now = new Date(),
    listReceivedEmails = listFromResend,
    fetchReceivedEmail,
    downloadAttachment,
}: {
    ai: AiProvider
    today: string
    now?: Date
    listReceivedEmails?: ListReceivedEmails
    fetchReceivedEmail?: (input: { id: string }) => Promise<ReceivedEmail>
    downloadAttachment?: DownloadEmailAttachment
}) {
    let emailsChecked = 0
    let filesFiled = 0
    let failed = 0
    let after: string | null = null
    for (;;) {
        const page = await listReceivedEmails({ after })
        for (const email of page.emails) {
            const isRecent = now.getTime() - new Date(email.createdAt).getTime() < WEBHOOK_GRACE_MS
            if (email.attachmentCount === 0 || isRecent) {
                continue
            }
            if (await hasAuditEntry({ action: EMAIL_FILES_AUDIT_ACTION, entityId: email.id })) {
                continue
            }
            emailsChecked += 1
            try {
                const outcome = await filePastEmailFiles({
                    receivedEmailId: email.id,
                    ai,
                    today,
                    ...(fetchReceivedEmail ? { fetchReceivedEmail } : {}),
                    ...(downloadAttachment ? { downloadAttachment } : {}),
                })
                filesFiled += outcome.filed
            } catch (error) {
                // One email Resend can no longer serve (attachments expire) mustn't stop the rest; it's
                // tried again on the next pass.
                failed += 1
                console.error(
                    '[mail] past email attachments not filed',
                    email.id,
                    error instanceof Error ? error.message : '',
                )
            }
        }
        if (!page.hasMore || page.emails.length === 0) {
            break
        }
        after = page.emails.at(-1)!.id
    }
    console.info(`[mail] filed ${filesFiled} files from ${emailsChecked} past emails (${failed} failed)`)
    return { emails_checked: emailsChecked, files_filed: filesFiled, failed }
}

/**
 * One page of received emails from Resend.
 *
 * @param input.after - Cursor: the last email id of the previous page, or null for the first.
 * @returns The emails and whether there are more.
 * @throws Error when Resend can't list them.
 */
async function listFromResend({ after }: { after: string | null }) {
    const { data, error } = await new Resend(config.resendApiKey).emails.receiving.list(
        after ? { limit: 100, after } : { limit: 100 },
    )
    if (error || !data) {
        throw new Error(`Resend couldn't list received emails: ${error?.message ?? 'no data'}`)
    }
    return {
        emails: data.data.map(email => ({
            id: email.id,
            createdAt: email.created_at,
            attachmentCount: email.attachments?.length ?? 0,
        })),
        hasMore: data.has_more,
    }
}
