import { Job } from 'sidequest'
import { aiProvider } from '#server/utils/ai/provider.ts'
import { config } from '#server/utils/config.ts'
import { todayDateOnly } from '#server/utils/dates.ts'
import { processInboundEmail } from '#server/utils/mail/inbound.ts'

/**
 * Processes one email sent to the dashboard (dashboard@ or a private address): instructions to carry
 * out, or a forward to file. Only Resend's id is queued; the email itself is fetched when the job runs,
 * so no email content sits in the job queue.
 */
export class ProcessForwardedEmailJob extends Job {
    /**
     * @param input.receivedEmailId - Resend's received email id.
     * @returns What happened, or a skip note.
     */
    async run({ receivedEmailId }: { receivedEmailId: string }) {
        const ai = aiProvider()
        if (!ai) {
            return { skipped: 'ANTHROPIC_API_KEY is not set' }
        }
        return processInboundEmail({
            receivedEmailId,
            ai,
            today: todayDateOnly({ timeZone: config.defaultTimeZone }),
        })
    }
}
