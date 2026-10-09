import { defineTask } from 'nitropack/runtime'
import { config } from '#server/utils/config.ts'
import { enqueueBookkeepingSync } from '#server/utils/jobs/enqueue.ts'

export default defineTask({
    meta: {
        name: 'bookkeeping-sync',
        description: 'Queue an hourly Bookeeping.ai sync of accounts, balances and transactions',
    },
    async run() {
        if (!config.runBackgroundWorkers) {
            return { result: 'skipped (workers disabled on this instance)' }
        }
        if (!config.bookkeepingApiKey) {
            return { result: 'skipped (BOOKEEPING_API_KEY is not set)' }
        }
        await enqueueBookkeepingSync()
        return { result: 'queued' }
    },
})
