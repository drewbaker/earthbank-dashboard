import { Resend } from 'resend'
import type { EmailMessage, EmailProvider } from '#server/utils/email/types.ts'

/**
 * Sends email through Resend.
 */
export class ResendProvider implements EmailProvider {
    readonly name = 'resend'
    private readonly client: Resend
    private readonly from: string

    /**
     * @param input.apiKey - Resend API key.
     * @param input.from - Sender, e.g. `Earth Bank Dashboard <noreply@mail.theearthbank.org>`.
     */
    constructor({ apiKey, from }: { apiKey: string; from: string }) {
        this.client = new Resend(apiKey)
        this.from = from
    }

    /**
     * Send one message.
     *
     * @param input.to - Recipient.
     * @param input.subject - Subject line.
     * @param input.html - HTML body.
     * @param input.text - Plain-text body.
     * @returns The Resend message id.
     * @throws Error when Resend rejects the message (the job retries).
     */
    async send({ to, subject, html, text }: EmailMessage) {
        const { data, error } = await this.client.emails.send({ from: this.from, to, subject, html, text })
        if (error) {
            throw new Error(`Resend rejected the message: ${error.message}`)
        }
        return { id: data?.id ?? null }
    }
}
