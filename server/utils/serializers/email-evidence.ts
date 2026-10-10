import type { EmailEvidence as EmailEvidenceRow, User as UserRow } from '#server/generated/prisma/client.ts'
import { config } from '#server/utils/config.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import type { EmailEvidence } from '#shared/schemas/index.ts'
import { emailDomain } from '#shared/utils/email-addresses.ts'

/**
 * Public shape of what was kept about an email: never the body. Only the counterpart address goes out,
 * not the full recipient list.
 *
 * @param input.evidence - The evidence row with its mailbox owner (and change count, when loaded).
 * @param input.viewer - The signed-in person. The Gmail link is only given to the person whose inbox the
 *   email was read from: nobody else can open it in their Gmail.
 * @returns The API representation.
 */
export function serializeEmailEvidence({
    evidence,
    viewer,
}: {
    evidence: EmailEvidenceRow & { mailbox_user: UserRow | null; _count?: { change_events: number } }
    viewer?: { id: string; email: string }
}): EmailEvidence {
    const isSent = config.internalEmailDomains.includes(emailDomain({ email: evidence.from_address }))
    const recipients = Array.isArray(evidence.to_addresses) ? (evidence.to_addresses as string[]) : []
    const externalRecipient = recipients.find(
        address => !config.internalEmailDomains.includes(emailDomain({ email: address })),
    )
    return {
        id: evidence.id,
        source: evidence.source === 'forward' ? 'forward' : 'gmail',
        direction: isSent ? 'sent' : 'received',
        from_address: evidence.from_address,
        counterpart: isSent ? (externalRecipient ?? recipients[0] ?? null) : evidence.from_address,
        sent_at: evidence.sent_at.toISOString(),
        subject: evidence.is_sensitive ? null : evidence.subject,
        summary: evidence.summary,
        is_relevant: evidence.is_relevant,
        is_sensitive: evidence.is_sensitive,
        funder_id: evidence.funder_id,
        mailbox_user: serializeUserSummary({ user: evidence.mailbox_user }),
        change_count: evidence._count?.change_events ?? null,
        gmail_url:
            viewer && evidence.mailbox_user_id === viewer.id
                ? gmailSearchUrl({ messageIdHeader: evidence.message_id_header, viewerEmail: viewer.email })
                : null,
    }
}

/**
 * A link that finds the email in Gmail by its Message-ID, in the given person's inbox.
 *
 * @param input.messageIdHeader - The RFC 5322 Message-ID.
 * @param input.viewerEmail - Whose Gmail to open.
 * @returns The URL, or null when the email had no Message-ID.
 */
function gmailSearchUrl({ messageIdHeader, viewerEmail }: { messageIdHeader: string; viewerEmail?: string }) {
    if (messageIdHeader.startsWith('gmail:')) {
        return null
    }
    const messageId = messageIdHeader.replace(/^<|>$/g, '')
    const account = viewerEmail ? `?authuser=${encodeURIComponent(viewerEmail)}` : ''
    return `https://mail.google.com/mail/${account}#search/${encodeURIComponent(`rfc822msgid:${messageId}`)}`
}
