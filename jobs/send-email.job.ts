import { Job } from 'sidequest'
import { emailProvider } from '#server/utils/email/provider.ts'
import type { EmailMessage } from '#server/utils/email/types.ts'

/**
 * Sends one transactional email. Retried by Sidequest on provider errors.
 */
export class SendEmailJob extends Job {
    /**
     * @param message - Recipient, subject and both bodies.
     * @returns The provider's message id.
     */
    async run({ to, subject, html, text }: EmailMessage) {
        return emailProvider().send({ to, subject, html, text })
    }
}
