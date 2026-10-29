import { Job } from 'sidequest'
import { aiProvider } from '#server/utils/ai/provider.ts'
import { config } from '#server/utils/config.ts'
import { todayDateOnly } from '#server/utils/dates.ts'
import { filePastEmailAttachments } from '#server/utils/mail/past-attachments.ts'

/**
 * Goes through the emails sent to the dashboard address and files the attachments of any that
 * haven't had theirs filed. Safe to retry and to run again: each email is handled once.
 */
export class FilePastEmailAttachmentsJob extends Job {
    /**
     * @returns Counts, or a skip note.
     */
    async run() {
        const ai = aiProvider()
        if (!ai || !config.resendApiKey) {
            return { skipped: 'ANTHROPIC_API_KEY or RESEND_API_KEY is not set' }
        }
        return filePastEmailAttachments({ ai, today: todayDateOnly({ timeZone: config.defaultTimeZone }) })
    }
}
