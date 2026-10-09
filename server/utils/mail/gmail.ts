import { gmail, type gmail_v1 } from '@googleapis/gmail'
import { googleOAuthClient } from '#server/utils/auth/google.ts'
import { htmlToText, parseAddressList, stripQuotedText } from '#server/utils/mail/normalize.ts'
import type { IncomingEmail } from '#server/utils/mail/types.ts'
import { normalizeEmailAddress } from '#shared/utils/email-addresses.ts'

export type GmailMessageHeaders = {
    gmailId: string
    messageIdHeader: string
    from: string
    recipients: string[]
    sentAt: Date
}

/**
 * Read-only access to one person's Gmail, authorized by their refresh token.
 */
export class GmailMailbox {
    private readonly api: gmail_v1.Gmail

    /**
     * @param input.refreshToken - Decrypted refresh token with `gmail.readonly`.
     */
    constructor({ refreshToken }: { refreshToken: string }) {
        const auth = googleOAuthClient()
        auth.setCredentials({ refresh_token: refreshToken })
        this.api = gmail({ version: 'v1', auth })
    }

    /**
     * Ids of messages matching a Gmail search, newest first.
     *
     * @param input.query - Gmail search query.
     * @param input.limit - Maximum ids to return.
     * @returns Gmail message ids.
     */
    async searchMessageIds({ query, limit }: { query: string; limit: number }) {
        const ids: string[] = []
        let pageToken: string | undefined
        do {
            const { data } = await this.api.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: Math.min(100, limit),
                pageToken,
            })
            ids.push(...(data.messages ?? []).flatMap(message => (message.id ? [message.id] : [])))
            pageToken = data.nextPageToken ?? undefined
        } while (pageToken && ids.length < limit)
        return ids.slice(0, limit)
    }

    /**
     * Just the headers needed to decide whether to read a message.
     *
     * @param input.gmailId - Gmail message id.
     * @returns Message-ID, sender and recipients.
     */
    async getMessageHeaders({ gmailId }: { gmailId: string }): Promise<GmailMessageHeaders> {
        const { data } = await this.api.users.messages.get({
            userId: 'me',
            id: gmailId,
            format: 'metadata',
            metadataHeaders: ['Message-ID', 'From', 'To', 'Cc'],
        })
        const header = headerReader({ headers: data.payload?.headers })
        return {
            gmailId,
            messageIdHeader: header('Message-ID') ?? `gmail:${gmailId}`,
            from: parseAddressList({ header: header('From') })[0] ?? '',
            recipients: [...parseAddressList({ header: header('To') }), ...parseAddressList({ header: header('Cc') })],
            sentAt: new Date(Number(data.internalDate ?? Date.now())),
        }
    }

    /**
     * The full message, normalized. The body is only held in memory by the caller.
     *
     * @param input.gmailId - Gmail message id.
     * @returns The email.
     */
    async getMessage({ gmailId }: { gmailId: string }): Promise<IncomingEmail> {
        const { data } = await this.api.users.messages.get({ userId: 'me', id: gmailId, format: 'full' })
        const header = headerReader({ headers: data.payload?.headers })
        return {
            messageIdHeader: header('Message-ID') ?? `gmail:${gmailId}`,
            from: normalizeEmailAddress({ email: header('From') ?? '' }) ?? '',
            to: parseAddressList({ header: header('To') }),
            cc: parseAddressList({ header: header('Cc') }),
            sentAt: data.internalDate ? new Date(Number(data.internalDate)) : new Date(header('Date') ?? Date.now()),
            subject: header('Subject') ?? '',
            text: stripQuotedText({ text: messageText({ part: data.payload }) }),
        }
    }
}

/**
 * Case-insensitive header lookup.
 *
 * @param input.headers - Gmail headers.
 * @returns A lookup function.
 */
function headerReader({ headers }: { headers: gmail_v1.Schema$MessagePartHeader[] | undefined }) {
    return (name: string) => headers?.find(header => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null
}

/**
 * The best plain-text body of a message: the first text/plain part, else text/html converted.
 *
 * @param input.part - The message payload.
 * @returns Plain text (may be empty).
 */
export function messageText({ part }: { part: gmail_v1.Schema$MessagePart | undefined }): string {
    const plain = findPart({ part, mimeType: 'text/plain' })
    if (plain?.body?.data) {
        return Buffer.from(plain.body.data, 'base64url').toString('utf8')
    }
    const html = findPart({ part, mimeType: 'text/html' })
    return html?.body?.data ? htmlToText({ html: Buffer.from(html.body.data, 'base64url').toString('utf8') }) : ''
}

/**
 * Depth-first search for a MIME part (attachments are skipped).
 *
 * @param input.part - Where to start.
 * @param input.mimeType - The type to find.
 * @returns The part, or null.
 */
function findPart({
    part,
    mimeType,
}: {
    part: gmail_v1.Schema$MessagePart | undefined
    mimeType: string
}): gmail_v1.Schema$MessagePart | null {
    if (!part) {
        return null
    }
    if (part.mimeType === mimeType && !part.filename) {
        return part
    }
    for (const child of part.parts ?? []) {
        const found = findPart({ part: child, mimeType })
        if (found) {
            return found
        }
    }
    return null
}
