import { normalizeEmailAddress } from '#shared/utils/email-addresses.ts'

const MAX_BODY_CHARACTERS = 8000

/**
 * Turn an HTML body into readable plain text.
 *
 * @param input.html - HTML email body.
 * @returns Plain text with block elements as line breaks.
 */
export function htmlToText({ html }: { html: string }) {
    return html
        .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/**
 * Keep only the new part of an email: drop quoted history ("On … wrote:", "> …", Outlook headers)
 * and signatures, then cap the length. Less text means less private content reaches the AI.
 *
 * @param input.text - Plain-text body.
 * @returns The trimmed body.
 */
export function stripQuotedText({ text }: { text: string }) {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    const kept: string[] = []
    for (const line of lines) {
        const trimmed = line.trim()
        // Outlook starts quoted history with a "From:" line after a blank line.
        const isOutlookHeader = /^From: .+/i.test(trimmed) && kept.length > 0 && kept.at(-1)!.trim() === ''
        const isQuoteStart =
            /^On .+wrote:\s*$/i.test(trimmed) ||
            /^-{2,}\s*Original Message\s*-{2,}/i.test(trimmed) ||
            /^_{10,}$/.test(trimmed) ||
            isOutlookHeader
        if (isQuoteStart || trimmed === '--') {
            break
        }
        if (!line.trimStart().startsWith('>')) {
            kept.push(line)
        }
    }
    const body = kept.join('\n').trim()
    return body.length > MAX_BODY_CHARACTERS ? `${body.slice(0, MAX_BODY_CHARACTERS)}\n[…truncated]` : body
}

/**
 * Pull addresses out of a header like `"Jane Doe" <jane@x.org>, bob@y.org`.
 *
 * @param input.header - Header value.
 * @returns Normalized addresses.
 */
export function parseAddressList({ header }: { header: string | null | undefined }) {
    if (!header) {
        return []
    }
    return header
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map(part => normalizeEmailAddress({ email: part }))
        .filter((address): address is string => address !== null)
}

/**
 * Find the original message inside a forwarded email: its sender, date and subject from the
 * "---------- Forwarded message ---------" block Gmail, Outlook and Apple Mail add.
 *
 * @param input.text - Plain-text body of the forward.
 * @returns The original sender, subject, date and the text after the header block, or null.
 */
export function unwrapForwardedMessage({ text }: { text: string }) {
    // Gmail, Apple Mail, older Outlook ("Original Message") and newer Outlook (an underscore rule
    // followed by a "From:" line).
    const marker = text.search(
        /-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:|-{3,}\s*Original Message\s*-{3,}|_{10,}\s*\n\s*\*?From:/i,
    )
    if (marker === -1) {
        return null
    }
    const block = text.slice(marker)
    const header = (name: string) =>
        block.match(new RegExp(`^\\s*\\*?${name}:\\*?\\s*(.+)$`, 'im'))?.[1]?.trim() ?? null
    const from = header('From')
    const fromAddress = from ? (parseAddressList({ header: from })[0] ?? null) : null
    if (!fromAddress) {
        return null
    }
    const lines = block.split('\n')
    const firstBlank = lines.findIndex((line, index) => index > 1 && line.trim() === '')
    return {
        from: fromAddress,
        to: parseAddressList({ header: header('To') }),
        subject: header('Subject') ?? '',
        dateText: header('Date') ?? header('Sent'),
        text: lines
            .slice(firstBlank === -1 ? 1 : firstBlank + 1)
            .join('\n')
            .trim(),
    }
}
