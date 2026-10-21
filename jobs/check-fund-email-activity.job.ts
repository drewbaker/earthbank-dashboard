import { Job } from 'sidequest'
import { listActiveMailboxConnections } from '#server/database/mailboxes.ts'
import { decryptSecret } from '#server/utils/crypto.ts'
import type { ActivityMailbox } from '#server/utils/funds/email-activity.ts'
import { checkFundEmailActivity } from '#server/utils/funds/email-activity.ts'
import { GmailMailbox } from '#server/utils/mail/gmail.ts'

/**
 * Finds the newest email with each approved fund's website domain in the team's connected Gmail
 * accounts and counts it as the fund's activity. Reads dates only. Safe to retry.
 */
export class CheckFundEmailActivityJob extends Job {
    /**
     * @returns How many funds were checked and updated.
     */
    async run() {
        const mailboxes: ActivityMailbox[] = []
        for (const connection of await listActiveMailboxConnections()) {
            const refreshToken = decryptSecret({ encrypted: connection.refresh_token_encrypted })
            if (refreshToken) {
                mailboxes.push({ userId: connection.user_id, reader: new GmailMailbox({ refreshToken }) })
            }
        }
        if (mailboxes.length === 0) {
            return { skipped: 'No Gmail connected' }
        }
        return checkFundEmailActivity({ mailboxes })
    }
}
