import { gmail, type gmail_v1 } from '@googleapis/gmail'
import { googleOAuthClient } from '#server/utils/auth/google.ts'
import { htmlToText, parseAddressList, stripQuotedText } from '#server/utils/mail/normalize.ts'
import type { IncomingEmail } from '#server/utils/mail/types.ts'
import { normalizeEmailAddress } from '#shared/utils/email-addresses.ts'

export type ThreadMessage = {
    gmailId: string
    messageIdHeader: string | null
    references: string | null
    from: string
    to: string[]
    cc: string[]
    sentAt: Date
    subject: string
    /** New text only (quoted history removed), held in memory while a reply is drafted. */
    text: string
}

export type GmailMessageHeaders = {
    gmailId: string
    messageIdHeader: string
    from: string
    recipients: string[]
    sentAt: Date
}

/**
 * Access to one person's Gmail, authorized by their refresh token: reading (`gmail.readonly`) and,
 * when granted, saving drafts (`gmail.compose`). Nothing here ever sends mail.
 */
export class GmailMailbox {
    private readonly api: gmail_v1.Gmail
    private readonly throttle = createGmailThrottle({})

    /**
     * @param input.refreshToken - Decrypted refresh token with `gmail.readonly` (and `gmail.compose` for drafts).
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
            const { data } = await this.throttle.run(() =>
                this.api.users.messages.list({
                    userId: 'me',
                    q: query,
                    maxResults: Math.min(100, limit),
                    pageToken,
                }),
            )
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
        const { data } = await this.throttle.run(() =>
            this.api.users.messages.get({
                userId: 'me',
                id: gmailId,
                format: 'metadata',
                metadataHeaders: ['Message-ID', 'From', 'To', 'Cc'],
            }),
        )
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
        const { data } = await this.throttle.run(() =>
            this.api.users.messages.get({ userId: 'me', id: gmailId, format: 'full' }),
        )
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

    /**
     * The messages of one thread, oldest first, with quoted history stripped from each.
     *
     * @param input.gmailMessageId - Any message in the thread.
     * @param input.limit - Keep only the latest this many messages.
     * @returns The Gmail thread id and its messages.
     */
    async getThreadOf({ gmailMessageId, limit }: { gmailMessageId: string; limit: number }) {
        const { data: message } = await this.throttle.run(() =>
            this.api.users.messages.get({
                userId: 'me',
                id: gmailMessageId,
                format: 'minimal',
            }),
        )
        const threadId = message.threadId!
        const { data } = await this.throttle.run(() =>
            this.api.users.threads.get({ userId: 'me', id: threadId, format: 'full' }),
        )
        const messages: ThreadMessage[] = (data.messages ?? []).slice(-limit).map(threadMessage => {
            const header = headerReader({ headers: threadMessage.payload?.headers })
            return {
                gmailId: threadMessage.id!,
                messageIdHeader: header('Message-ID'),
                references: header('References'),
                from: normalizeEmailAddress({ email: header('From') ?? '' }) ?? '',
                to: parseAddressList({ header: header('To') }),
                cc: parseAddressList({ header: header('Cc') }),
                sentAt: new Date(Number(threadMessage.internalDate ?? Date.now())),
                subject: header('Subject') ?? '',
                text: stripQuotedText({ text: messageText({ part: threadMessage.payload }) }),
            }
        })
        return { threadId, messages }
    }

    /**
     * Save a draft in the person's Gmail. It is never sent; they review and send it themselves.
     *
     * @param input.raw - The RFC 822 message.
     * @param input.threadId - Gmail thread to file the draft in, for replies.
     * @returns The draft id and its message id (used to open it in Gmail).
     */
    async createDraft({ raw, threadId }: { raw: string; threadId: string | null }) {
        const { data } = await this.throttle.run(() =>
            this.api.users.drafts.create({
                userId: 'me',
                requestBody: {
                    message: { raw: Buffer.from(raw, 'utf8').toString('base64url'), threadId: threadId ?? undefined },
                },
            }),
        )
        return { draftId: data.id!, messageId: data.message?.id ?? null }
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

/** Google's per-user Gmail quota is spent fast by a first sync; this keeps under it. */
const GMAIL_MIN_INTERVAL_MS = 100
const GMAIL_RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 60_000, 60_000]

/**
 * Pace Gmail API calls (at most one per `minIntervalMs`) and wait and retry when Google says the
 * per-minute quota or rate limit was hit, instead of failing the whole sync.
 *
 * @param input.minIntervalMs - Least time between calls.
 * @param input.retryDelaysMs - Waits before each retry after a rate-limit error.
 * @param input.wait - Delay function (tests pass a fake).
 * @param input.now - Clock (tests pass a fake).
 * @returns `{ run }`, which runs one call through the throttle.
 */
export function createGmailThrottle({
    minIntervalMs = GMAIL_MIN_INTERVAL_MS,
    retryDelaysMs = GMAIL_RETRY_DELAYS_MS,
    wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)),
    now = () => Date.now(),
}: {
    minIntervalMs?: number
    retryDelaysMs?: number[]
    wait?: (milliseconds: number) => Promise<void>
    now?: () => number
}) {
    let nextCallAt = 0
    return {
        /**
         * Run one Gmail call, paced and retried on rate limits.
         *
         * @param call - The API call.
         * @returns Its result.
         * @throws The last error when retries run out, or any non-rate-limit error at once.
         */
        async run<Result>(call: () => Promise<Result>): Promise<Result> {
            for (let attempt = 0; ; attempt++) {
                const delay = nextCallAt - now()
                if (delay > 0) {
                    await wait(delay)
                }
                nextCallAt = now() + minIntervalMs
                try {
                    return await call()
                } catch (error) {
                    const retryDelay = retryDelaysMs[attempt]
                    if (retryDelay === undefined || !isGmailRateLimit({ error })) {
                        throw error
                    }
                    console.info('[mail] Gmail rate limit, waiting', retryDelay / 1000, 'seconds')
                    await wait(retryDelay)
                }
            }
        },
    }
}

/**
 * Whether an error is Gmail saying "too many requests" (quota per minute, rate limit), which passes.
 *
 * @param input.error - The thrown error.
 * @returns True for rate and quota limits.
 */
export function isGmailRateLimit({ error }: { error: unknown }) {
    const status = (error as { status?: number; code?: number })?.status ?? (error as { code?: number })?.code
    const message = error instanceof Error ? error.message : String(error)
    return (
        status === 429 ||
        (status === 403 && /rate ?limit|quota/i.test(message)) ||
        /quota exceeded|rate limit exceeded/i.test(message)
    )
}
