import { Resend } from 'resend'
import {
    findActiveInboundAddressForUser,
    findInboundAddressByTokenHash,
    replaceInboundAddress,
} from '#server/database/inbound-addresses.ts'
import { hasAuditEntry } from '#server/database/audit-logs.ts'
import { listFunderMatchData } from '#server/database/funders.ts'
import { findActiveUserByEmail } from '#server/database/users.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { config } from '#server/utils/config.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { decryptSecret, encryptSecret, hashToken } from '#server/utils/crypto.ts'
import { renderEmail } from '#server/utils/email/layout.ts'
import { enqueueEmail } from '#server/utils/jobs/enqueue.ts'
import { proposeDraftFunder, processFunderEmail } from '#server/utils/mail/classify.ts'
import type { ProcessEmailResult } from '#server/utils/mail/classify.ts'
import type { InstructionAction } from '#server/utils/mail/instructions.ts'
import { carryOutEmailInstructions } from '#server/utils/mail/instructions.ts'
import { buildFunderMatchIndex, matchFunder } from '#server/utils/mail/matching.ts'
import { htmlToText, senderNote, stripQuotedText, unwrapForwardedMessage } from '#server/utils/mail/normalize.ts'
import type { IncomingEmail } from '#server/utils/mail/types.ts'
import { emailDomain, normalizeEmailAddress } from '#shared/utils/email-addresses.ts'
import { randomBytes } from 'node:crypto'

const LOCAL_PART = 'updates'

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
}

/**
 * A user's private forwarding address, creating one the first time.
 *
 * @param input.userId - The user.
 * @returns e.g. `updates+k3j…@mail.theearthbank.org`.
 */
export async function forwardingAddressFor({ userId }: { userId: string }) {
    const existing = await findActiveInboundAddressForUser({ userId })
    const token = existing ? decryptSecret({ encrypted: existing.token_encrypted }) : null
    return token ? addressFromToken({ token }) : regenerateForwardingAddress({ userId })
}

/**
 * Give a user a new forwarding address; the old one stops working immediately.
 *
 * @param input.userId - The user.
 * @returns The new address.
 */
export async function regenerateForwardingAddress({ userId }: { userId: string }) {
    // Lowercase letters and digits only: some mail systems lowercase the local part.
    const token = randomBytes(15).toString('hex')
    await replaceInboundAddress({
        userId,
        tokenHash: hashToken({ token }),
        tokenEncrypted: encryptSecret({ plaintext: token }),
        now: new Date(),
    })
    return addressFromToken({ token })
}

/**
 * Find the forwarding token among an email's recipients.
 *
 * @param input.recipients - To and received-for addresses.
 * @param input.domain - The inbound domain.
 * @returns The token, or null.
 */
export function forwardingTokenFrom({ recipients, domain }: { recipients: string[]; domain: string }) {
    for (const recipient of recipients) {
        const match = recipient
            .toLowerCase()
            .match(new RegExp(`${LOCAL_PART}\\+([a-z0-9]+)@${domain.replace(/\./g, '\\.')}`))
        if (match) {
            return match[1]!
        }
    }
    return null
}

export type InboundEmailResult =
    | { kind: 'ignored'; reason: string }
    | { kind: 'instructions'; actions: InstructionAction[]; isVerified: boolean }
    | { kind: 'forward'; result: ProcessEmailResult }

/**
 * Handle an email sent to the dashboard: dashboard@theearthbank.org, or a person's private address.
 *
 * Who sent it: a private address's secret token proves it; for the shared dashboard address the
 * sender must be a team member and the email must pass DMARC/DKIM for an Earth Bank domain.
 *
 * What it is: if they wrote something above (or instead of) a forwarded message, it's instructions
 * ("add this funder", "mark UBS approved"), which the AI carries out as them and then emails them
 * what it did. A plain forward updates the funder it's about, or drafts a new funder.
 *
 * @param input.receivedEmailId - Resend's id for the received email.
 * @param input.ai - The AI provider.
 * @param input.today - Today's date for the team (YYYY-MM-DD).
 * @param input.fetchReceivedEmail - Loads the email (Resend by default; tests pass a fake).
 * @returns What happened.
 */
export async function processInboundEmail({
    receivedEmailId,
    ai,
    today,
    fetchReceivedEmail = fetchFromResend,
}: {
    receivedEmailId: string
    ai: AiProvider
    today: string
    fetchReceivedEmail?: (input: { id: string }) => Promise<ReceivedEmail>
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
    const hasInstructions = note.replace(/^(fyi|fwd?:?|see below|thanks?)[\s.!]*$/i, '').length > 0

    if (!hasInstructions) {
        if (!forwarded || config.internalEmailDomains.includes(emailDomain({ email: forwarded.from }))) {
            // Without a recognizable forwarded header the only sender we know is the person who
            // forwarded it, which would wrongly become a funder contact.
            console.info('[mail] forwarded email had no recognizable original sender', receivedEmailId)
            return { kind: 'ignored', reason: 'nothing to do' }
        }
        const index = buildFunderMatchIndex({
            funders: await listFunderMatchData(),
            internalDomains: config.internalEmailDomains,
        })
        const funderId = matchFunder({
            index,
            from: forwarded.from,
            recipients: [...forwarded.to, ...forwarded.cc],
        })
        const result = funderId
            ? await processFunderEmail({
                  email: forwarded,
                  funderId,
                  source: 'forward',
                  mailboxUserId: sender.user.id,
                  ai,
              })
            : await proposeDraftFunder({ email: forwarded, forwardedByUserId: sender.user.id, ai })
        return { kind: 'forward', result }
    }

    // Webhooks can be delivered twice; instructions must only ever be carried out once.
    if (await hasAuditEntry({ action: INSTRUCTION_AUDIT_ACTION, entityId: received.id })) {
        return { kind: 'ignored', reason: 'already processed' }
    }
    const subject = received.subject || '(no subject)'
    let reply: string
    let actions: InstructionAction[] = []
    if (sender.isVerified) {
        const outcome = await carryOutEmailInstructions({
            sender: { id: sender.user.id, name: sender.user.name, email: sender.user.email },
            subject,
            instructions: note,
            forwarded:
                forwarded && !config.internalEmailDomains.includes(emailDomain({ email: forwarded.from }))
                    ? forwarded
                    : null,
            ai,
            today,
        })
        reply = outcome.reply
        actions = outcome.actions
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
    return { kind: 'instructions', actions, isVerified: sender.isVerified }
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
    const token = forwardingTokenFrom({ recipients, domain: config.inboundEmailDomain })
    if (token) {
        const inboundAddress = await findInboundAddressByTokenHash({ tokenHash: hashToken({ token }) })
        return inboundAddress && !inboundAddress.user.deactivated_at
            ? { user: inboundAddress.user, isVerified: true }
            : null
    }
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
async function fetchFromResend({ id }: { id: string }): Promise<ReceivedEmail> {
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
    }
}

/**
 * The full forwarding address for a token.
 *
 * @param input.token - The token.
 * @returns The address.
 */
function addressFromToken({ token }: { token: string }) {
    return `${LOCAL_PART}+${token}@${config.inboundEmailDomain}`
}
