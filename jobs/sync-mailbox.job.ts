import { Job } from 'sidequest'
import { finishMailboxSync, findMailboxConnection, recordMailboxSyncProgress } from '#server/database/mailboxes.ts'
import { aiProvider } from '#server/utils/ai/provider.ts'
import { syncMailbox } from '#server/utils/mail/sync.ts'

/**
 * Reads new funder email from one connected Gmail account, recording its progress for Settings → Email.
 * Safe to retry: emails are deduplicated.
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
            if (connection) {
                await finishMailboxSync({ mailboxConnectionId, result: null })
            }
            return { skipped: !ai ? 'ANTHROPIC_API_KEY is not set' : 'mailbox not active' }
        }
        const startedAt = new Date()
        let isFirstUpdate = true
        let lastPhase: string | null = null
        let result = null
        try {
            result = await syncMailbox({
                connection,
                ai,
                now: startedAt,
                onProgress: async ({ phase, done, total }) => {
                    // A line per step and every 25 emails, so syncs can be followed in the server logs too.
                    if (phase !== lastPhase || (phase === 'reading' && done > 0 && done % 25 === 0)) {
                        console.info(`[mail] ${mailboxConnectionId} ${phase} ${done}/${total ?? '?'}`)
                        lastPhase = phase
                    }
                    await recordMailboxSyncProgress({
                        mailboxConnectionId,
                        phase,
                        done,
                        total,
                        startedAt: isFirstUpdate ? startedAt : undefined,
                    })
                    isFirstUpdate = false
                },
            })
            return result
        } finally {
            // Always leave the progress tidy, even when the sync fails (the error is on the connection).
            await finishMailboxSync({
                mailboxConnectionId,
                result: result ? { ...result, finished_at: new Date().toISOString() } : null,
            })
        }
    }
}
