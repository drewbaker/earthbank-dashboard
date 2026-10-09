import { findProcessedMessageIds } from '#server/database/email-evidence.ts'
import { listFunderMatchData } from '#server/database/funders.ts'
import type { MailboxConnection } from '#server/generated/prisma/client.ts'
import { recordMailboxSync } from '#server/database/mailboxes.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { config } from '#server/utils/config.ts'
import { decryptSecret } from '#server/utils/crypto.ts'
import { processFunderEmail } from '#server/utils/mail/classify.ts'
import type { GmailMessageHeaders } from '#server/utils/mail/gmail.ts'
import { GmailMailbox } from '#server/utils/mail/gmail.ts'
import { buildFunderMailQueries, buildFunderMatchIndex, matchFunder } from '#server/utils/mail/matching.ts'
import type { IncomingEmail } from '#server/utils/mail/types.ts'

// A first sync looks back 90 days; later syncs overlap the previous one by a day. A funder backfill
// looks back a year. Each run reads at most this many messages, so a big backlog spreads over runs.
const FIRST_SYNC_DAYS = 90
const RESYNC_OVERLAP_DAYS = 1
const BACKFILL_DAYS = 365
const MAX_MESSAGES_PER_RUN = 150
// Upper bound on ids collected per run; headers are cheap, but this keeps one run bounded.
const MAX_SEARCH_RESULTS = 1000

export type MailboxSyncResult = { matched: number; processed: number; applied: number; pending: number }

export type MailboxSyncProgress = {
    phase: 'searching' | 'checking' | 'reading'
    done: number
    total: number | null
}

type ReadResult = MailboxSyncResult & { resumeFrom: Date | null }

/** What sync needs from a mailbox (Gmail in production, a fake in tests). */
export type MailboxReader = {
    searchMessageIds(input: { query: string; limit: number }): Promise<string[]>
    getMessageHeaders(input: { gmailId: string }): Promise<GmailMessageHeaders>
    getMessage(input: { gmailId: string }): Promise<IncomingEmail>
}

/**
 * Read new funder email from one Gmail account and update the pipeline.
 *
 * Only mail to or from known funder addresses and domains is ever fetched (Gmail search does the
 * filtering), and each email is processed once across all inboxes.
 *
 * @param input.connection - The mailbox connection.
 * @param input.ai - The AI provider.
 * @param input.now - Current time.
 * @param input.funderId - Limit to one funder and look back a year (backfill after adding a funder).
 * @param input.mailbox - Mailbox to read (defaults to the connection's Gmail; tests pass a fake).
 * @param input.maxMessagesPerRun - How many emails to read this run.
 * @param input.onProgress - Called as the sync moves along (for the progress shown in Settings).
 * @returns Counts of what happened.
 * @throws Rethrows Gmail errors after recording them on the connection.
 */
export async function syncMailbox({
    connection,
    ai,
    now,
    funderId,
    mailbox,
    maxMessagesPerRun = MAX_MESSAGES_PER_RUN,
    onProgress,
}: {
    connection: MailboxConnection
    ai: AiProvider
    now: Date
    funderId?: string
    mailbox?: MailboxReader
    maxMessagesPerRun?: number
    onProgress?: (progress: MailboxSyncProgress) => Promise<void>
}): Promise<MailboxSyncResult> {
    const refreshToken = decryptSecret({ encrypted: connection.refresh_token_encrypted })
    if (!refreshToken) {
        await recordMailboxSync({
            mailboxConnectionId: connection.id,
            lastError: 'Stored token is unreadable; reconnect Gmail.',
            status: 'error',
        })
        return { matched: 0, processed: 0, applied: 0, pending: 0 }
    }
    try {
        const { resumeFrom, ...result } = await readFunderMail({
            mailbox: mailbox ?? new GmailMailbox({ refreshToken }),
            connection,
            ai,
            now,
            funderId,
            maxMessagesPerRun,
            onProgress: onProgress ?? (async () => undefined),
        })
        // When mail was left for the next run, only advance the sync point to the oldest email still
        // waiting, so the next run's search window still includes it.
        await recordMailboxSync({
            mailboxConnectionId: connection.id,
            lastSyncedAt: funderId ? undefined : (resumeFrom ?? now),
            lastError: null,
        })
        return result
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // invalid_grant means the person revoked access or the token expired: stop until they reconnect.
        const isRevoked = /invalid_grant|unauthorized_client/i.test(message)
        await recordMailboxSync({
            mailboxConnectionId: connection.id,
            lastError: isRevoked ? 'Google access was revoked or expired; reconnect Gmail.' : message,
            status: isRevoked ? 'error' : undefined,
        })
        console.error('[mail] sync failed', connection.id, message)
        if (isRevoked) {
            return { matched: 0, processed: 0, applied: 0, pending: 0 }
        }
        throw error
    }
}

/**
 * Search, filter and classify.
 *
 * @param input.mailbox - The mailbox to read.
 * @param input.maxMessagesPerRun - How many emails to read this run.
 * @param input.connection - The mailbox connection.
 * @param input.ai - The AI provider.
 * @param input.now - Current time.
 * @param input.funderId - Optional single funder (backfill).
 * @param input.onProgress - Progress callback.
 * @returns Counts of what happened, and where the next run should resume when mail was left over.
 */
async function readFunderMail({
    mailbox,
    connection,
    ai,
    now,
    funderId,
    maxMessagesPerRun,
    onProgress,
}: {
    mailbox: MailboxReader
    connection: MailboxConnection
    ai: AiProvider
    now: Date
    funderId?: string
    maxMessagesPerRun: number
    onProgress: (progress: MailboxSyncProgress) => Promise<void>
}): Promise<ReadResult> {
    const allFunders = await listFunderMatchData()
    const funders = funderId ? allFunders.filter(funder => funder.id === funderId) : allFunders
    const index = buildFunderMatchIndex({ funders: allFunders, internalDomains: config.internalEmailDomains })
    const lookbackDays = funderId ? BACKFILL_DAYS : connection.last_synced_at ? null : FIRST_SYNC_DAYS
    const after = lookbackDays
        ? new Date(now.getTime() - lookbackDays * 86_400_000)
        : new Date(connection.last_synced_at!.getTime() - RESYNC_OVERLAP_DAYS * 86_400_000)
    const queries = buildFunderMailQueries({
        contactEmails: funders.flatMap(funder => funder.contactEmails),
        domains: funders.flatMap(funder => funder.emailDomains),
        after,
        internalDomains: config.internalEmailDomains,
    })

    const gmailIds = new Set<string>()
    await onProgress({ phase: 'searching', done: 0, total: queries.length })
    for (const [queryIndex, query] of queries.entries()) {
        for (const id of await mailbox.searchMessageIds({ query, limit: MAX_SEARCH_RESULTS })) {
            gmailIds.add(id)
        }
        await onProgress({ phase: 'searching', done: queryIndex + 1, total: queries.length })
    }

    // Headers first (cheap): keep only funder mail not yet read in any inbox, oldest first.
    const candidates = []
    const toCheck = [...gmailIds].slice(0, MAX_SEARCH_RESULTS)
    for (const [checkIndex, gmailId] of toCheck.entries()) {
        // Headers are quick to read; report every 25 so progress writes stay cheap.
        if (checkIndex % 25 === 0) {
            await onProgress({ phase: 'checking', done: checkIndex, total: toCheck.length })
        }
        const headers = await mailbox.getMessageHeaders({ gmailId })
        const matchedFunderId = matchFunder({ index, from: headers.from, recipients: headers.recipients })
        if (matchedFunderId && (!funderId || matchedFunderId === funderId)) {
            candidates.push({ ...headers, funderId: matchedFunderId })
        }
    }
    const processedIds = await findProcessedMessageIds({
        messageIdHeaders: candidates.map(candidate => candidate.messageIdHeader),
    })
    const unread = candidates
        .filter(candidate => !processedIds.has(candidate.messageIdHeader))
        .sort((first, second) => first.sentAt.getTime() - second.sentAt.getTime())
    // A regular sync works forward from the oldest unread email and resumes from the first one it
    // couldn't get to. A one-off backfill reads the most recent emails (they matter most).
    const batch = funderId ? unread.slice(-maxMessagesPerRun) : unread.slice(0, maxMessagesPerRun)
    const resumeFrom = !funderId && unread.length > maxMessagesPerRun ? unread[maxMessagesPerRun]!.sentAt : null

    const result: ReadResult = { matched: unread.length, processed: 0, applied: 0, pending: 0, resumeFrom }
    for (const [readIndex, candidate] of batch.entries()) {
        await onProgress({ phase: 'reading', done: readIndex, total: batch.length })
        const email = await mailbox.getMessage({ gmailId: candidate.gmailId })
        const outcome = await processFunderEmail({
            email,
            funderId: candidate.funderId,
            source: 'gmail',
            mailboxUserId: connection.user_id,
            ai,
        })
        if (outcome.status === 'processed') {
            result.processed++
            result.applied += outcome.applied
            result.pending += outcome.pending
        }
    }
    console.info(
        `[mail] ${connection.google_email}: ${result.processed} new funder emails, ${result.applied} applied, ${result.pending} for review`,
    )
    return result
}
