import { Job } from 'sidequest'
import { bookkeepingProvider } from '#server/utils/bookkeeping/provider.ts'
import { syncBookkeeping } from '#server/utils/bookkeeping/sync.ts'

/**
 * Pulls accounts, balances and transactions from Bookeeping.ai. Safe to retry: everything is upserted.
 */
export class SyncBookkeepingJob extends Job {
    /**
     * @returns Counts of what was synced, or a skip note when no API key is set.
     */
    async run() {
        const provider = bookkeepingProvider()
        if (!provider) {
            return { skipped: 'BOOKEEPING_API_KEY is not set' }
        }
        return syncBookkeeping({ provider, now: new Date() })
    }
}
