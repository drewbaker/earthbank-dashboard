import { Job } from 'sidequest'
import { aiProvider } from '#server/utils/ai/provider.ts'
import { processForwardedEmail } from '#server/utils/mail/inbound.ts'

/**
 * Processes one email forwarded to a private updates address. Only Resend's id is queued; the email
 * itself is fetched when the job runs, so no email content sits in the job queue.
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
        return processForwardedEmail({ receivedEmailId, ai })
    }
}
