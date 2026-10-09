import { config } from '#server/utils/config.ts'
import { ConsoleProvider } from '#server/utils/email/console.ts'
import { ResendProvider } from '#server/utils/email/resend.ts'
import type { EmailProvider } from '#server/utils/email/types.ts'

/**
 * Pick the email provider from config: Resend when a key is set, else the console (dev only).
 *
 * @returns The provider.
 * @throws Error in production without a Resend key, so task content never lands in logs.
 */
export function emailProvider(): EmailProvider {
    if (config.resendApiKey) {
        return new ResendProvider({ apiKey: config.resendApiKey, from: config.emailFrom })
    }
    if (config.isProduction) {
        throw new Error('RESEND_API_KEY is required in production')
    }
    return new ConsoleProvider()
}
