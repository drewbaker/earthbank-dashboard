import type { EmailMessage, EmailProvider } from '#server/utils/email/types.ts'

/**
 * Development fallback: prints emails to the console instead of sending them.
 */
export class ConsoleProvider implements EmailProvider {
    readonly name = 'console'

    /**
     * Print one message.
     *
     * @param input.to - Recipient.
     * @param input.subject - Subject line.
     * @param input.html - HTML body (not printed).
     * @param input.text - Plain-text body.
     * @returns A null id.
     */
    async send({ to, subject, text }: EmailMessage) {
        console.info(`[email] (console) to=${to} subject="${subject}"\n${text}`)
        return { id: null }
    }
}
