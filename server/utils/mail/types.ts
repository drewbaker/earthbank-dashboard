// A normalized email, whether it came from Gmail or a forwarded message. The body exists only in
// memory while the email is classified; it is never stored.
export type IncomingEmail = {
    /** RFC 5322 Message-ID (deduplicates the same email across inboxes). */
    messageIdHeader: string
    from: string
    to: string[]
    cc: string[]
    sentAt: Date
    subject: string
    /** Plain text, quoted replies and signatures removed, capped in length. */
    text: string
}
