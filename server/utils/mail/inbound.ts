import { Resend } from 'resend'
import { hasAuditEntry } from '#server/database/audit-logs.ts'
import { listFunderMatchData } from '#server/database/funders.ts'
import { findActiveUserByEmail } from '#server/database/users.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { config } from '#server/utils/config.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { renderEmail } from '#server/utils/email/layout.ts'
import { enqueueEmail } from '#server/utils/jobs/enqueue.ts'
import { proposeDraftFunder, processFunderEmail } from '#server/utils/mail/classify.ts'
import type { ProcessEmailResult } from '#server/utils/mail/classify.ts'
import type { DownloadEmailAttachment, ReceivedAttachment } from '#server/utils/mail/email-files.ts'
import { fileEmailFile, screenEmailFiles } from '#server/utils/mail/email-files.ts'
import type { InstructionAction } from '#server/utils/mail/instructions.ts'
import { carryOutEmailInstructions, fileEmailAttachments } from '#server/utils/mail/instructions.ts'
import { buildFunderMatchIndex, matchFunder } from '#server/utils/mail/matching.ts'
import { htmlToText, senderNote, stripQuotedText, unwrapForwardedMessage } from '#server/utils/mail/normalize.ts'
import type { IncomingEmail } from '#server/utils/mail/types.ts'
import { emailDomain, normalizeEmailAddress } from '#shared/utils/email-addresses.ts'

export type ReceivedEmail = {
    id: string
    from: string
    to: string[]
    receivedFor: string[]
    subject: string
    text: string | null
    html: string | null
    /** Header name → value, for checking the email is authentic. */
    headers: Record<string, string> | null
    createdAt: string
    /** Files attached to it (metadata only; the bytes are downloaded when they're filed). */
    attachments?: ReceivedAttachment[]
}

export type InboundEmailResult =
    | { kind: 'ignored'; reason: string }
    | { kind: 'instructions'; actions: InstructionAction[]; isVerified: boolean; filed: number }
    | { kind: 'forward'; result: ProcessEmailResult; filed: number }
    | { kind: 'files'; filed: number }

// Recorded once an email's attachments have been looked at (filed or left alone), so a redelivered
// webhook or the pass over past emails never files them twice.
export const EMAIL_FILES_AUDIT_ACTION = 'email_attachments.processed'

/**
 * Handle an email sent to dashboard@theearthbank.org.
 *
 * Who sent it: the sender must be a team member and the email must pass DMARC/DKIM for an Earth
 * Bank domain.
 *
 * What it is: if they wrote something above (or instead of) a forwarded message, it's instructions
 * ("add this funder", "mark UBS approved"), which the AI carries out as them and then emails them
 * what it did. A plain forward updates the funder it's about, or drafts a new funder.
 *
 * Attached documents (from a verified team member) are filed with the funder or fund they're about
 * and read by the AI; signature images, invites and personal documents are left alone.
 *
 * @param input.receivedEmailId - Resend's id for the received email.
 * @param input.ai - The AI provider.
 * @param input.today - Today's date for the team (YYYY-MM-DD).
 * @param input.fetchReceivedEmail - Loads the email (Resend by default; tests pass a fake).
 * @param input.downloadAttachment - Downloads an attachment (Resend by default; tests pass a fake).
 * @returns What happened.
 */
export async function processInboundEmail({
    receivedEmailId,
    ai,
    today,
    fetchReceivedEmail = fetchFromResend,
    downloadAttachment,
}: {
    receivedEmailId: string
    ai: AiProvider
    today: string
    fetchReceivedEmail?: (input: { id: string }) => Promise<ReceivedEmail>
    downloadAttachment?: DownloadEmailAttachment
}): Promise<InboundEmailResult> {
    const received = await fetchReceivedEmail({ id: receivedEmailId })
    const sender = await identifySender({ received })
    if (!sender) {
        console.info('[mail] inbound email from an unknown sender or address', receivedEmailId)
        return { kind: 'ignored', reason: 'unknown sender' }
    }

    const body = received.text ?? (received.html ? htmlToText({ html: received.html }) : '')
    const note = senderNote({ text: body })
    const forwarded = originalOfForward({ received })
    // The body is the request; with an empty body (a question typed in the subject line, say), the
    // subject is. A forward's subject is the original email's, so it never counts as a request.
    const bodyRequest = note.replace(/^(fyi|fwd?:?|see below|thanks?)[\s.!]*$/i, '')
    const subjectRequest = forwarded ? '' : (received.subject ?? '').replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').trim()
    const request = bodyRequest || subjectRequest
    const hasInstructions = request.length > 0
    const files = await screenFilesOnce({ received, sender, ai, download: downloadAttachment })

    if (!hasInstructions) {
        if (!forwarded || config.internalEmailDomains.includes(emailDomain({ email: forwarded.from }))) {
            if (files) {
                const filed = await fileWithAssistant({ received, sender, files, context: body, ai, today })
                return { kind: 'files', filed }
            }
            // Without a recognizable forwarded header the only sender we know is the person who
            // forwarded it, which would wrongly become a funder contact.
            console.info('[mail] forwarded email had no recognizable original sender', receivedEmailId)
            return { kind: 'ignored', reason: 'nothing to do' }
        }
        const funderId = await matchForwardedFunder({ forwarded })
        const result = funderId
            ? await processFunderEmail({
                  email: forwarded,
                  funderId,
                  source: 'forward',
                  mailboxUserId: sender.user.id,
                  ai,
              })
            : await proposeDraftFunder({ email: forwarded, forwardedByUserId: sender.user.id, ai })
        let filed = 0
        if (files) {
            // A plain forward's files belong with the funder it's about (or the drafted one); when it
            // matched no funder, the assistant looks for the funder or fund they're about.
            const targetFunderId = funderId ?? (result.status === 'draft_funder_created' ? result.funderId : null)
            filed = targetFunderId
                ? await fileWithFunder({ received, sender, files, funderId: targetFunderId })
                : await fileWithAssistant({ received, sender, files, context: body, ai, today })
        }
        return { kind: 'forward', result, filed }
    }

    // Webhooks can be delivered twice; instructions must only ever be carried out once.
    if (await hasAuditEntry({ action: INSTRUCTION_AUDIT_ACTION, entityId: received.id })) {
        return { kind: 'ignored', reason: 'already processed' }
    }
    const subject = received.subject || '(no subject)'
    let reply: string
    let actions: InstructionAction[] = []
    let filed = 0
    if (sender.isVerified) {
        const outcome = await carryOutEmailInstructions({
            sender: { id: sender.user.id, name: sender.user.name, email: sender.user.email },
            subject,
            instructions: request,
            forwarded:
                forwarded && !config.internalEmailDomains.includes(emailDomain({ email: forwarded.from }))
                    ? forwarded
                    : null,
            files: files?.files ?? [],
            receivedEmail: { id: received.id, receivedAt: new Date(received.createdAt) },
            ai,
            today,
        })
        reply = outcome.reply
        actions = outcome.actions
        filed = outcome.filedCount
        if (files) {
            await recordFilesProcessed({ received, sender, filed, skipped: files.skipped })
        }
    } else {
        reply =
            "This email couldn't be verified as coming from you (it didn't pass the domain's DMARC/DKIM checks), so nothing was changed. If you sent it, try again from your Earth Bank Gmail. If you didn't, someone may be sending email in your name."
    }
    await recordAudit({
        actor: { type: 'user', userId: sender.user.id },
        action: INSTRUCTION_AUDIT_ACTION,
        entityType: 'inbound_email',
        entityId: received.id,
        changes: { is_verified: sender.isVerified, actions: actions.map(action => action.description) },
    })
    await replyToSender({ to: sender.user.email, subject, reply, actions })
    return { kind: 'instructions', actions, isVerified: sender.isVerified, filed }
}

/**
 * File the attachments of an email sent to the dashboard before attachments were read (or whose
 * webhook was lost), without carrying out its instructions again and without replying. A plain forward
 * files with the funder it's about; otherwise the assistant finds the funder or fund each file is
 * about.
 *
 * @param input.receivedEmailId - Resend's id for the email.
 * @param input.ai - The AI provider.
 * @param input.today - Today's date for the team (YYYY-MM-DD).
 * @param input.fetchReceivedEmail - Loads the email (Resend by default; tests pass a fake).
 * @param input.downloadAttachment - Downloads an attachment (Resend by default; tests pass a fake).
 * @returns How many files were filed, or why none were.
 */
export async function filePastEmailFiles({
    receivedEmailId,
    ai,
    today,
    fetchReceivedEmail = fetchFromResend,
    downloadAttachment,
}: {
    receivedEmailId: string
    ai: AiProvider
    today: string
    fetchReceivedEmail?: (input: { id: string }) => Promise<ReceivedEmail>
    downloadAttachment?: DownloadEmailAttachment
}) {
    const received = await fetchReceivedEmail({ id: receivedEmailId })
    const sender = await identifySender({ received })
    if (!sender) {
        return { filed: 0, reason: 'unknown sender' }
    }
    const files = await screenFilesOnce({ received, sender, ai, download: downloadAttachment })
    if (!files) {
        return { filed: 0, reason: 'nothing to file' }
    }
    const body = received.text ?? (received.html ? htmlToText({ html: received.html }) : '')
    const forwarded = originalOfForward({ received })
    const hasNote = senderNote({ text: body }).replace(/^(fyi|fwd?:?|see below|thanks?)[\s.!]*$/i, '').length > 0
    const funderId =
        forwarded && !hasNote && !config.internalEmailDomains.includes(emailDomain({ email: forwarded.from }))
            ? await matchForwardedFunder({ forwarded })
            : null
    const filed = funderId
        ? await fileWithFunder({ received, sender, files, funderId })
        : await fileWithAssistant({ received, sender, files, context: body, ai, today, shouldReply: false })
    return { filed, reason: null }
}

type Sender = NonNullable<Awaited<ReturnType<typeof identifySender>>>
type ScreenedFiles = Awaited<ReturnType<typeof screenEmailFiles>>

/**
 * Screen an email's attachments, once per email and only for a verified team member. Returns null
 * when there's nothing to file: no attachments, already handled, or not verified (recorded as handled,
 * so they're never looked at again). When every attachment is left alone (signatures, invites,
 * personal files) that's recorded here too.
 *
 * @param input.received - The email.
 * @param input.sender - Who sent it.
 * @param input.ai - The AI provider.
 * @param input.download - Downloads an attachment.
 * @returns The screened files (at least one), or null.
 */
async function screenFilesOnce({
    received,
    sender,
    ai,
    download,
}: {
    received: ReceivedEmail
    sender: Sender
    ai: AiProvider
    download?: DownloadEmailAttachment
}): Promise<ScreenedFiles | null> {
    if (!received.attachments?.length) {
        return null
    }
    if (await hasAuditEntry({ action: EMAIL_FILES_AUDIT_ACTION, entityId: received.id })) {
        return null
    }
    if (!sender.isVerified) {
        await recordFilesProcessed({ received, sender, filed: 0, skipped: [], note: 'not verified' })
        return null
    }
    const screened = await screenEmailFiles({
        receivedEmailId: received.id,
        attachments: received.attachments,
        subject: received.subject,
        ai,
        ...(download ? { download } : {}),
    })
    if (screened.files.length === 0) {
        await recordFilesProcessed({ received, sender, filed: 0, skipped: screened.skipped })
        return null
    }
    return screened
}

/**
 * File every screened file with one funder (a plain forward's funder).
 *
 * @param input.received - The email.
 * @param input.sender - Who sent it.
 * @param input.files - The screened files.
 * @param input.funderId - The funder.
 * @returns How many were filed.
 */
async function fileWithFunder({
    received,
    sender,
    files,
    funderId,
}: {
    received: ReceivedEmail
    sender: Sender
    files: ScreenedFiles
    funderId: string
}) {
    for (const file of files.files) {
        await fileEmailFile({
            file,
            target: { kind: 'funder', funderId },
            senderUserId: sender.user.id,
            receivedEmail: { id: received.id, receivedAt: new Date(received.createdAt) },
        })
    }
    await recordFilesProcessed({ received, sender, filed: files.files.length, skipped: files.skipped })
    return files.files.length
}

/**
 * Have the assistant file each screened file with the funder or fund it's about, then (for a new
 * email) tell the sender where they went.
 *
 * @param input.received - The email.
 * @param input.sender - Who sent it.
 * @param input.files - The screened files.
 * @param input.context - The email's text, for context.
 * @param input.ai - The AI provider.
 * @param input.today - Today's date (YYYY-MM-DD).
 * @param input.shouldReply - Email the sender what was filed (not for past emails).
 * @returns How many were filed.
 */
async function fileWithAssistant({
    received,
    sender,
    files,
    context,
    ai,
    today,
    shouldReply = true,
}: {
    received: ReceivedEmail
    sender: Sender
    files: ScreenedFiles
    context: string
    ai: AiProvider
    today: string
    shouldReply?: boolean
}) {
    const subject = received.subject || '(no subject)'
    const outcome = await fileEmailAttachments({
        sender: { id: sender.user.id, name: sender.user.name, email: sender.user.email },
        subject,
        context,
        files: files.files,
        receivedEmail: { id: received.id, receivedAt: new Date(received.createdAt) },
        ai,
        today,
    })
    await recordFilesProcessed({ received, sender, filed: outcome.filedCount, skipped: files.skipped })
    if (shouldReply) {
        await replyToSender({ to: sender.user.email, subject, reply: outcome.reply, actions: outcome.actions })
    }
    return outcome.filedCount
}

/**
 * Record that an email's attachments were handled: how many were filed and why others were left
 * alone (file names only, never content).
 *
 * @param input.received - The email.
 * @param input.sender - Who sent it.
 * @param input.filed - How many were filed.
 * @param input.skipped - What was left alone, and why.
 * @param input.note - Why nothing was looked at, if so.
 * @returns Resolves once written.
 */
async function recordFilesProcessed({
    received,
    sender,
    filed,
    skipped,
    note = null,
}: {
    received: ReceivedEmail
    sender: Sender
    filed: number
    skipped: { filename: string; reason: string }[]
    note?: string | null
}) {
    await recordAudit({
        actor: { type: 'user', userId: sender.user.id },
        action: EMAIL_FILES_AUDIT_ACTION,
        entityType: 'inbound_email',
        entityId: received.id,
        changes: {
            filed,
            // Personal files are counted, not named.
            left_alone: skipped.map(item =>
                item.reason === 'personal' ? 'personal' : `${item.filename} (${item.reason})`,
            ),
            ...(note ? { note } : {}),
        },
    })
}

/**
 * The funder a forwarded email is from or to, by contact address or domain.
 *
 * @param input.forwarded - The forwarded original.
 * @returns The funder id, or null.
 */
async function matchForwardedFunder({ forwarded }: { forwarded: IncomingEmail }) {
    const index = buildFunderMatchIndex({
        funders: await listFunderMatchData(),
        internalDomains: config.internalEmailDomains,
    })
    return matchFunder({ index, from: forwarded.from, recipients: [...forwarded.to, ...forwarded.cc] })
}

/** @deprecated Old name, kept so queued jobs and imports keep working. */
export const processForwardedEmail = processInboundEmail

const INSTRUCTION_AUDIT_ACTION = 'email_instruction.processed'

/**
 * Who sent an inbound email, and whether that's proven.
 *
 * @param input.received - The received email.
 * @returns The team member and whether the email is verified, or null when it isn't from the team.
 */
async function identifySender({ received }: { received: ReceivedEmail }) {
    const recipients = [...received.to, ...received.receivedFor].map(address => address.toLowerCase())
    if (!recipients.some(address => isDashboardAddress({ address }))) {
        return null
    }
    // A Google Group rewrites From to the group's own address; the person is then in these headers.
    const fromAddress = normalizeEmailAddress({ email: received.from }) ?? ''
    const senderAddress = isDashboardAddress({ address: fromAddress })
        ? (normalizeEmailAddress({
              email: headerValue({ headers: received.headers, name: 'x-original-sender' }) ?? '',
          }) ?? normalizeEmailAddress({ email: headerValue({ headers: received.headers, name: 'reply-to' }) ?? '' }))
        : fromAddress
    if (!senderAddress) {
        return null
    }
    const user = await findActiveUserByEmail({
        email: senderAddress,
        workspaceDomain: config.googleWorkspaceDomain,
        internalDomains: config.internalEmailDomains,
    })
    return user ? { user, isVerified: isAuthenticatedEarthBankEmail({ headers: received.headers }) } : null
}

/**
 * Whether an address is the shared dashboard address, as the team writes it or as Workspace routes
 * it on to the receiving domain (dashboard@mail.theearthbank.org).
 *
 * @param input.address - Lowercased address.
 * @returns True for the dashboard address.
 */
export function isDashboardAddress({ address }: { address: string }) {
    const [local] = config.dashboardEmailAddress.split('@')
    return address === config.dashboardEmailAddress || address === `${local}@${config.inboundEmailDomain}`
}

/**
 * Whether the receiving server found the email genuinely from an Earth Bank domain: an
 * Authentication-Results header with `dmarc=pass` (or `dkim=pass`) for one of Earth Bank's domains.
 * Without it a "From: leslie@theearthbank.org" could be forged, so instructions aren't carried out.
 *
 * @param input.headers - The email's headers.
 * @returns True when authenticated.
 */
export function isAuthenticatedEarthBankEmail({ headers }: { headers: Record<string, string> | null }) {
    const results = headerValue({ headers, name: 'authentication-results' }) ?? ''
    return config.internalEmailDomains.some(domain => {
        const escaped = domain.replace(/\./g, '\\.')
        return (
            new RegExp(`dmarc=pass[^;]*header\\.from=${escaped}`, 'i').test(results) ||
            new RegExp(`dkim=pass[^;]*header\\.(d|i)=@?${escaped}`, 'i').test(results)
        )
    })
}

/**
 * Case-insensitive header lookup.
 *
 * @param input.headers - Headers, or null.
 * @param input.name - Header name.
 * @returns The value, or null.
 */
function headerValue({ headers, name }: { headers: Record<string, string> | null; name: string }) {
    if (!headers) {
        return null
    }
    const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name)
    return key ? (headers[key] ?? null) : null
}

/**
 * Email the sender what the assistant did, with links.
 *
 * @param input.to - The sender.
 * @param input.subject - Their email's subject.
 * @param input.reply - The assistant's reply.
 * @param input.actions - What it did.
 * @returns Resolves once queued.
 */
async function replyToSender({
    to,
    subject,
    reply,
    actions,
}: {
    to: string
    subject: string
    reply: string
    actions: InstructionAction[]
}) {
    const { html, text } = renderEmail({
        heading: actions.length ? 'Done' : 'Nothing changed yet',
        paragraphs: [
            ...reply.split(/\n{2,}|\n/).filter(Boolean),
            ...actions.map(action => `• ${action.description}: ${action.url}`),
            'Every change is on the Activity page, where it can be reverted.',
        ],
        buttonLabel: 'Open Activity',
        buttonUrl: `${config.appUrl}/activity`,
    })
    await enqueueEmail({
        to,
        subject: subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`,
        html,
        text,
    })
}

/**
 * The original message inside a forward (sender, subject, text).
 *
 * @param input.received - The received email.
 * @returns The email to classify, or null when no forwarded header block was found.
 */
export function originalOfForward({ received }: { received: ReceivedEmail }): IncomingEmail | null {
    const body = received.text ?? (received.html ? htmlToText({ html: received.html }) : '')
    const forwarded = unwrapForwardedMessage({ text: body })
    if (!forwarded) {
        return null
    }
    const parsedDate = forwarded.dateText ? new Date(forwarded.dateText.replace(/ at /, ' ')) : null
    return {
        // Forwarded copies don't carry the original Message-ID, so the received id deduplicates.
        messageIdHeader: `forward:${received.id}`,
        from: forwarded.from,
        to: forwarded.to,
        cc: [],
        sentAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date(received.createdAt),
        subject: forwarded.subject || received.subject.replace(/^(fwd?|fw):\s*/i, ''),
        text: stripQuotedText({ text: forwarded.text }),
    }
}

/**
 * Load a received email from Resend.
 *
 * @param input.id - Resend's received email id.
 * @returns The email.
 * @throws Error when Resend can't return it.
 */
export async function fetchFromResend({ id }: { id: string }): Promise<ReceivedEmail> {
    const { data, error } = await new Resend(config.resendApiKey).emails.receiving.get(id)
    if (error || !data) {
        throw new Error(`Resend couldn't return received email ${id}: ${error?.message ?? 'no data'}`)
    }
    return {
        id: data.id,
        from: data.from,
        to: data.to,
        receivedFor: data.received_for ?? [],
        subject: data.subject ?? '',
        text: data.text,
        html: data.html,
        headers: data.headers ?? null,
        createdAt: data.created_at,
        attachments: (data.attachments ?? []).map(attachment => ({
            id: attachment.id,
            filename: attachment.filename,
            contentType: attachment.content_type,
            size: attachment.size,
            contentDisposition: attachment.content_disposition,
        })),
    }
}
