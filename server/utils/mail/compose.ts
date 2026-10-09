/**
 * Build a plain-text RFC 822 message for a Gmail draft.
 *
 * Header values have line breaks removed (no header injection), non-ASCII subjects are encoded
 * (RFC 2047) and the body is base64 so any character survives.
 *
 * @param input.from - The sender's address.
 * @param input.to - Recipient addresses.
 * @param input.cc - Cc addresses.
 * @param input.subject - Subject line.
 * @param input.body - Plain-text body.
 * @param input.inReplyTo - Message-ID being replied to, so mail clients thread it.
 * @param input.references - The References chain of the thread.
 * @returns The message, with CRLF line endings.
 */
export function buildDraftMessage({
    from,
    to,
    cc,
    subject,
    body,
    inReplyTo,
    references,
}: {
    from: string
    to: string[]
    cc: string[]
    subject: string
    body: string
    inReplyTo: string | null
    references: string | null
}) {
    const headers = [
        `From: ${headerValue({ value: from })}`,
        `To: ${to.map(address => headerValue({ value: address })).join(', ')}`,
        ...(cc.length ? [`Cc: ${cc.map(address => headerValue({ value: address })).join(', ')}`] : []),
        `Subject: ${encodeSubject({ subject: headerValue({ value: subject }) })}`,
        ...(inReplyTo ? [`In-Reply-To: ${headerValue({ value: inReplyTo })}`] : []),
        ...(inReplyTo || references
            ? [`References: ${headerValue({ value: [references, inReplyTo].filter(Boolean).join(' ') })}`]
            : []),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
    ]
    const encodedBody = (
        Buffer.from(body.replace(/\r?\n/g, '\r\n'), 'utf8')
            .toString('base64')
            .match(/.{1,76}/g) ?? []
    ).join('\r\n')
    return `${headers.join('\r\n')}\r\n\r\n${encodedBody}\r\n`
}

/**
 * "Re: …" for a reply, without stacking prefixes.
 *
 * @param input.subject - The thread's subject.
 * @returns The reply subject.
 */
export function replySubject({ subject }: { subject: string }) {
    const trimmed = subject.trim()
    return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed || '(no subject)'}`
}

/**
 * A header value on one line.
 *
 * @param input.value - Raw value.
 * @returns The value with CR and LF replaced by spaces.
 */
function headerValue({ value }: { value: string }) {
    return value.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Encode a subject for the header: as is when ASCII, else RFC 2047 base64.
 *
 * @param input.subject - The subject.
 * @returns The header-safe subject.
 */
function encodeSubject({ subject }: { subject: string }) {
    return /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
}
