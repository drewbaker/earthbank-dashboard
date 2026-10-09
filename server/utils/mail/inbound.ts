import { Resend } from 'resend'
import {
    findActiveInboundAddressForUser,
    findInboundAddressByTokenHash,
    replaceInboundAddress,
} from '#server/database/inbound-addresses.ts'
import { listFunderMatchData } from '#server/database/funders.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { config } from '#server/utils/config.ts'
import { decryptSecret, encryptSecret, hashToken } from '#server/utils/crypto.ts'
import { proposeDraftFunder, processFunderEmail } from '#server/utils/mail/classify.ts'
import type { ProcessEmailResult } from '#server/utils/mail/classify.ts'
import { buildFunderMatchIndex, matchFunder } from '#server/utils/mail/matching.ts'
import { htmlToText, stripQuotedText, unwrapForwardedMessage } from '#server/utils/mail/normalize.ts'
import type { IncomingEmail } from '#server/utils/mail/types.ts'
import { emailDomain } from '#shared/utils/email-addresses.ts'
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
    createdAt: string
}

/**
 * A user's private forwarding address, creating one the first time.
 *
 * @param input.userId - The user.
 * @returns e.g. `updates+k3j…@in.theearthbank.org`.
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

/**
 * Process an email someone forwarded to their private address: work out the original message, then
 * update the funder it's about, or draft a new funder when the sender isn't known.
 *
 * Any sender may forward (the point is mail that reached a personal address); the secret token in
 * the address is what proves it came from a team member.
 *
 * @param input.receivedEmailId - Resend's id for the received email.
 * @param input.ai - The AI provider.
 * @param input.fetchReceivedEmail - Loads the email (Resend by default; tests pass a fake).
 * @returns What happened, or null when the address isn't a live forwarding address.
 */
export async function processForwardedEmail({
    receivedEmailId,
    ai,
    fetchReceivedEmail = fetchFromResend,
}: {
    receivedEmailId: string
    ai: AiProvider
    fetchReceivedEmail?: (input: { id: string }) => Promise<ReceivedEmail>
}): Promise<ProcessEmailResult | null> {
    const received = await fetchReceivedEmail({ id: receivedEmailId })
    const token = forwardingTokenFrom({
        recipients: [...received.to, ...received.receivedFor],
        domain: config.inboundEmailDomain,
    })
    const inboundAddress = token ? await findInboundAddressByTokenHash({ tokenHash: hashToken({ token }) }) : null
    if (!inboundAddress || inboundAddress.user.deactivated_at) {
        console.info('[mail] forwarded email to an unknown or revoked address', receivedEmailId)
        return null
    }

    const email = originalOfForward({ received })
    if (!email || config.internalEmailDomains.includes(emailDomain({ email: email.from }))) {
        // Without a recognizable forwarded header the only sender we know is the person who forwarded
        // it, which would wrongly become a funder contact.
        console.info('[mail] forwarded email had no recognizable original sender', receivedEmailId)
        return null
    }
    const index = buildFunderMatchIndex({
        funders: await listFunderMatchData(),
        internalDomains: config.internalEmailDomains,
    })
    const funderId = matchFunder({ index, from: email.from, recipients: [...email.to, ...email.cc] })
    return funderId
        ? processFunderEmail({ email, funderId, source: 'forward', mailboxUserId: inboundAddress.user_id, ai })
        : proposeDraftFunder({ email, forwardedByUserId: inboundAddress.user_id, ai })
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
