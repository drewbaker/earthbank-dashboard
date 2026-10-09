import { findProcessedMessageIds } from '#server/database/email-evidence.ts'
import { listFunderMatchData } from '#server/database/funders.ts'
import type { MailboxConnection } from '#server/generated/prisma/client.ts'
import { recordMailboxSync } from '#server/database/mailboxes.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { decryptSecret } from '#server/utils/crypto.ts'
import { processFunderEmail } from '#server/utils/mail/classify.ts'
import { GmailMailbox } from '#server/utils/mail/gmail.ts'
import { buildFunderMailQueries, buildFunderMatchIndex, matchFunder } from '#server/utils/mail/matching.ts'

// A first sync looks back 90 days; later syncs overlap the previous one by a day. A funder backfill
// looks back a year. Each run reads at most this many messages, so a big backlog spreads over runs.
const FIRST_SYNC_DAYS = 90
const RESYNC_OVERLAP_DAYS = 1
const BACKFILL_DAYS = 365
const MAX_MESSAGES_PER_RUN = 150

export type MailboxSyncResult = { matched: number; processed: number; applied: number; pending: number }

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
 * @returns Counts of what happened.
 * @throws Rethrows Gmail errors after recording them on the connection.
 */
export async function syncMailbox({
    connection,
    ai,
    now,
    funderId,
}: {
    connection: MailboxConnection
    ai: AiProvider
    now: Date
    funderId?: string
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
        const result = await readFunderMail({ refreshToken, connection, ai, now, funderId })
        await recordMailboxSync({
            mailboxConnectionId: connection.id,
            lastSyncedAt: funderId ? undefined : now,
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
 * @param input.refreshToken - Decrypted refresh token.
 * @param input.connection - The mailbox connection.
 * @param input.ai - The AI provider.
 * @param input.now - Current time.
 * @param input.funderId - Optional single funder (backfill).
 * @returns Counts of what happened.
 */
async function readFunderMail({
    refreshToken,
    connection,
    ai,
    now,
    funderId,
}: {
    refreshToken: string
    connection: MailboxConnection
    ai: AiProvider
    now: Date
    funderId?: string
}) {
    const allFunders = await listFunderMatchData()
    const funders = funderId ? allFunders.filter(funder => funder.id === funderId) : allFunders
    const index = buildFunderMatchIndex({ funders: allFunders })
    const lookbackDays = funderId ? BACKFILL_DAYS : connection.last_synced_at ? null : FIRST_SYNC_DAYS
    const after = lookbackDays
        ? new Date(now.getTime() - lookbackDays * 86_400_000)
        : new Date(connection.last_synced_at!.getTime() - RESYNC_OVERLAP_DAYS * 86_400_000)
    const queries = buildFunderMailQueries({
        contactEmails: funders.flatMap(funder => funder.contactEmails),
        domains: funders.flatMap(funder => funder.emailDomains),
        after,
    })

    const mailbox = new GmailMailbox({ refreshToken })
    const gmailIds = new Set<string>()
    for (const query of queries) {
        for (const id of await mailbox.searchMessageIds({ query, limit: MAX_MESSAGES_PER_RUN })) {
            gmailIds.add(id)
        }
    }

    const result: MailboxSyncResult = { matched: gmailIds.size, processed: 0, applied: 0, pending: 0 }
    // Oldest first, so the pipeline moves forward in the order things happened.
    for (const gmailId of [...gmailIds].reverse().slice(0, MAX_MESSAGES_PER_RUN)) {
        const headers = await mailbox.getMessageHeaders({ gmailId })
        if ((await findProcessedMessageIds({ messageIdHeaders: [headers.messageIdHeader] })).size > 0) {
            continue
        }
        const matchedFunderId = matchFunder({ index, from: headers.from, recipients: headers.recipients })
        if (!matchedFunderId || (funderId && matchedFunderId !== funderId)) {
            continue
        }
        const email = await mailbox.getMessage({ gmailId })
        const outcome = await processFunderEmail({
            email,
            funderId: matchedFunderId,
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
