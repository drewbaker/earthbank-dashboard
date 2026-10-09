import { Job } from 'sidequest'
import { findMailboxConnection } from '#server/database/mailboxes.ts'
import { aiProvider } from '#server/utils/ai/provider.ts'
import { syncMailbox } from '#server/utils/mail/sync.ts'

/**
 * Reads new funder email from one connected Gmail account. Safe to retry: emails are deduplicated.
 */
export class SyncMailboxJob extends Job {
    /**
     * @param input.mailboxConnectionId - The connection to sync.
     * @returns Counts, or a skip note.
     */
    async run({ mailboxConnectionId }: { mailboxConnectionId: string }) {
        const ai = aiProvider()
        const connection = await findMailboxConnection({ mailboxConnectionId })
        if (!ai || !connection || connection.status !== 'active') {
            return { skipped: !ai ? 'ANTHROPIC_API_KEY is not set' : 'mailbox not active' }
        }
        return syncMailbox({ connection, ai, now: new Date() })
    }
}
