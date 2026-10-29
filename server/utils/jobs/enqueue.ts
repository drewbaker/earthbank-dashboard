import { BackfillFunderJob } from '#root/jobs/backfill-funder.job.ts'
import { CheckFundEmailActivityJob } from '#root/jobs/check-fund-email-activity.job.ts'
import { CheckFundNamesJob } from '#root/jobs/check-fund-names.job.ts'
import { FilePastEmailAttachmentsJob } from '#root/jobs/file-past-email-attachments.job.ts'
import { ProcessForwardedEmailJob } from '#root/jobs/process-forwarded-email.job.ts'
import { ReadAttachmentJob } from '#root/jobs/read-attachment.job.ts'
import { ResearchFundJob } from '#root/jobs/research-fund.job.ts'
import { ScreenPendingFundsJob } from '#root/jobs/screen-pending-funds.job.ts'
import { SendEmailJob } from '#root/jobs/send-email.job.ts'
import { SyncBookkeepingJob } from '#root/jobs/sync-bookkeeping.job.ts'
import { SyncKnowledgeJob } from '#root/jobs/sync-knowledge.job.ts'
import { SyncMailboxJob } from '#root/jobs/sync-mailbox.job.ts'
import { SyncPublicInvestmentsJob } from '#root/jobs/sync-public-investments.job.ts'
import { DuplicatedJobError } from 'sidequest'
import { markMailboxSyncQueued } from '#server/database/mailboxes.ts'
import { ensureJobQueue, Sidequest } from '#server/utils/jobs/sidequest.ts'

/**
 * Queue one transactional email; retried up to 5 times on provider errors.
 *
 * @param input.to - Recipient address.
 * @param input.subject - Subject line.
 * @param input.html - HTML body.
 * @param input.text - Plain-text body.
 * @returns The queued Sidequest job.
 */
export async function enqueueEmail({
    to,
    subject,
    html,
    text,
}: {
    to: string
    subject: string
    html: string
    text: string
}) {
    await ensureJobQueue()
    return Sidequest.build(SendEmailJob).queue('email').maxAttempts(5).enqueue({ to, subject, html, text })
}

/**
 * Queue a Bookeeping.ai sync. Only one can be waiting at a time, so the hourly task and the
 * "Sync now" button never pile up.
 *
 * @returns `queued`, or `already_queued` when one is already waiting or running.
 */
export async function enqueueBookkeepingSync() {
    await ensureJobQueue()
    return queueOnce({
        enqueue: () =>
            Sidequest.build(SyncBookkeepingJob)
                .queue('default')
                .maxAttempts(3)
                .timeout(10 * 60 * 1000)
                .unique(true)
                .enqueue(),
    })
}

// Mail jobs share one queue with concurrency 1: they call the AI and write the pipeline, and running
// them one at a time keeps change order predictable and stays well inside API rate limits.
// Gmail calls are paced to stay under Google's per-user quota, so a first sync of a busy inbox can take
// a while; the 45-minute timeout leaves room for it.

/**
 * Queue a Gmail sync for one mailbox (one waiting sync per mailbox at a time).
 *
 * @param input.mailboxConnectionId - The connection.
 * @returns `queued`, or `already_queued` when one is already waiting or running.
 */
export async function enqueueMailboxSync({ mailboxConnectionId }: { mailboxConnectionId: string }) {
    await ensureJobQueue()
    const status = await queueOnce({
        enqueue: () =>
            Sidequest.build(SyncMailboxJob)
                .queue('mail')
                .maxAttempts(3)
                .timeout(45 * 60 * 1000)
                .unique({ withArgs: true })
                .enqueue({ mailboxConnectionId }),
    })
    // Settings → Email shows "waiting to start" until the worker picks it up.
    await markMailboxSyncQueued({ mailboxConnectionId })
    return status
}

/**
 * Queue a year of email backfill for a funder across every connected mailbox.
 *
 * @param input.funderId - The funder.
 * @returns `queued`, or `already_queued` when one is already waiting or running.
 */
export async function enqueueFunderBackfill({ funderId }: { funderId: string }) {
    await ensureJobQueue()
    return queueOnce({
        enqueue: () =>
            Sidequest.build(BackfillFunderJob)
                .queue('mail')
                .maxAttempts(3)
                .timeout(45 * 60 * 1000)
                .unique({ withArgs: true })
                .enqueue({ funderId }),
    })
}

/**
 * Queue processing of one forwarded email.
 *
 * @param input.receivedEmailId - Resend's received email id.
 * @returns The queued job.
 */
export async function enqueueForwardedEmail({ receivedEmailId }: { receivedEmailId: string }) {
    await ensureJobQueue()
    return Sidequest.build(ProcessForwardedEmailJob).queue('mail').maxAttempts(5).enqueue({ receivedEmailId })
}

/**
 * Queue the AI reading of a funder or fund file (once per file at a time). It runs on the default
 * queue, not behind long Gmail syncs, so an uploaded file is read within a minute or two.
 *
 * @param input.attachmentId - The file.
 * @returns `queued`, or `already_queued` when it's already waiting or being read.
 */
export async function enqueueAttachmentRead({ attachmentId }: { attachmentId: string }) {
    await ensureJobQueue()
    return queueOnce({
        enqueue: () =>
            Sidequest.build(ReadAttachmentJob)
                .queue('default')
                .maxAttempts(3)
                .timeout(15 * 60 * 1000)
                .unique({ withArgs: true })
                .enqueue({ attachmentId }),
    })
}

/**
 * Queue a pass over every email sent to the dashboard address, filing the attachments of any that
 * haven't had theirs filed (emails from before attachments were read, or whose webhook was lost).
 *
 * @returns `queued`, or `already_queued` when a pass is waiting or running.
 */
export async function enqueuePastEmailAttachments() {
    await ensureJobQueue()
    return queueOnce({
        enqueue: () =>
            Sidequest.build(FilePastEmailAttachmentsJob)
                .queue('mail')
                .maxAttempts(3)
                .timeout(60 * 60 * 1000)
                .unique(true)
                .enqueue(),
    })
}

/**
 * Queue a sync of one Drive knowledge folder (once per folder at a time).
 *
 * @param input.knowledgeSourceId - The source.
 * @returns `queued`, or `already_queued` when one is already waiting or running.
 */
export async function enqueueKnowledgeSync({ knowledgeSourceId }: { knowledgeSourceId: string }) {
    await ensureJobQueue()
    return queueOnce({
        enqueue: () =>
            Sidequest.build(SyncKnowledgeJob)
                .queue('default')
                .maxAttempts(3)
                .timeout(20 * 60 * 1000)
                .unique({ withArgs: true })
                .enqueue({ knowledgeSourceId }),
    })
}

/**
 * Enqueue a unique job, treating "already waiting or running" as success: pressing Sync twice, or
 * the schedule firing during a sync, should not be an error.
 *
 * @param input.enqueue - Enqueues the job.
 * @returns `queued`, or `already_queued` when an identical job is waiting or running.
 */
async function queueOnce({ enqueue }: { enqueue: () => Promise<unknown> }): Promise<'queued' | 'already_queued'> {
    try {
        await enqueue()
        return 'queued'
    } catch (error) {
        if (error instanceof DuplicatedJobError) {
            return 'already_queued'
        }
        throw error
    }
}

/**
 * Queue research for one fund. Seeds and funds the team added use the `research` queue, which runs
 * ahead of spidered funds on `research-spider`. Only one job per fund can be waiting.
 *
 * @param input.fundManagerId - The fund to research.
 * @param input.isPriority - Whether it goes ahead of spidered funds.
 * @returns `queued`, or `already_queued`.
 */
export async function enqueueFundResearch({
    fundManagerId,
    isPriority,
}: {
    fundManagerId: string
    isPriority: boolean
}) {
    await ensureJobQueue()
    return queueOnce({
        enqueue: () =>
            Sidequest.build(ResearchFundJob)
                .queue(isPriority ? 'research' : 'research-spider')
                .maxAttempts(3)
                .timeout(30 * 60 * 1000)
                .unique({ withArgs: true })
                .enqueue({ fundManagerId }),
    })
}

/**
 * Queue the daily check of connected Gmail for recent email with each fund (one job at a time).
 *
 * @returns `queued`, or `already_queued`.
 */
export async function enqueueFundEmailActivityCheck() {
    await ensureJobQueue()
    return queueOnce({
        enqueue: () =>
            Sidequest.build(CheckFundEmailActivityJob)
                .queue('default')
                .maxAttempts(2)
                .timeout(30 * 60 * 1000)
                .unique(true)
                .enqueue(),
    })
}

/**
 * Queue the name check of funds whose names nobody has tidied yet (one job at a time).
 *
 * @returns `queued`, or `already_queued`.
 */
export async function enqueueFundNameCheck() {
    await ensureJobQueue()
    return queueOnce({
        enqueue: () =>
            Sidequest.build(CheckFundNamesJob)
                .queue('research-spider')
                .maxAttempts(3)
                .timeout(10 * 60 * 1000)
                .unique(true)
                .enqueue(),
    })
}

/**
 * Queue a screen of pending funds the AI hasn't checked yet (one job at a time).
 *
 * @returns `queued`, or `already_queued`.
 */
export async function enqueuePendingFundScreening() {
    await ensureJobQueue()
    return queueOnce({
        enqueue: () =>
            Sidequest.build(ScreenPendingFundsJob)
                .queue('research-spider')
                .maxAttempts(3)
                .timeout(10 * 60 * 1000)
                .unique(true)
                .enqueue(),
    })
}

/**
 * Queue a read of one public DFI or government investment list.
 *
 * @param input.sourceKey - The list's key (PUBLIC_INVESTMENT_SOURCES).
 * @returns `queued`, or `already_queued`.
 */
export async function enqueuePublicInvestmentSync({ sourceKey }: { sourceKey: string }) {
    await ensureJobQueue()
    return queueOnce({
        enqueue: () =>
            Sidequest.build(SyncPublicInvestmentsJob)
                .queue('research-spider')
                .maxAttempts(2)
                .timeout(60 * 60 * 1000)
                .unique({ withArgs: true })
                .enqueue({ sourceKey }),
    })
}
