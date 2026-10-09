import { SendEmailJob } from '#root/jobs/send-email.job.ts'
import { SyncBookkeepingJob } from '#root/jobs/sync-bookkeeping.job.ts'
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
 * @returns The queued Sidequest job.
 */
export async function enqueueBookkeepingSync() {
    await ensureJobQueue()
    return Sidequest.build(SyncBookkeepingJob)
        .queue('default')
        .maxAttempts(3)
        .timeout(10 * 60 * 1000)
        .unique(true)
        .enqueue()
}
