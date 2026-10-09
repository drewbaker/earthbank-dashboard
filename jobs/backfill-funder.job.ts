import { Job } from 'sidequest'
import { listActiveMailboxConnections } from '#server/database/mailboxes.ts'
import { aiProvider } from '#server/utils/ai/provider.ts'
import { syncMailbox } from '#server/utils/mail/sync.ts'

/**
 * After a funder (or contact) is added, reads the past year of email with them from every connected
 * mailbox, so their timeline and stage catch up. Safe to retry: emails are deduplicated.
 */
export class BackfillFunderJob extends Job {
    /**
     * @param input.funderId - The funder.
     * @returns Counts per mailbox, or a skip note.
     */
    async run({ funderId }: { funderId: string }) {
        const ai = aiProvider()
        if (!ai) {
            return { skipped: 'ANTHROPIC_API_KEY is not set' }
        }
        const results = []
        for (const connection of await listActiveMailboxConnections()) {
            results.push(await syncMailbox({ connection, ai, now: new Date(), funderId }))
        }
        return results
    }
}
