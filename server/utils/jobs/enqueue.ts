import { SendEmailJob } from '#root/jobs/send-email.job.ts'
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
