import { defineNitroPlugin } from 'nitropack/runtime'
import { config } from '#server/utils/config.ts'
import { enqueueBookkeepingSync } from '#server/utils/jobs/enqueue.ts'
import { ensureJobQueue, startJobWorkers, stopJobWorkers } from '#server/utils/jobs/sidequest.ts'

export default defineNitroPlugin(async nitroApp => {
    if (config.runBackgroundWorkers) {
        await startJobWorkers({ rebuildBundle: import.meta.dev })
        // Sync bank data right after a deploy instead of waiting up to an hour for the schedule.
        if (config.bookkeepingApiKey) {
            await enqueueBookkeepingSync().catch(error => console.error('[bookkeeping] startup sync not queued', error))
        }
    } else {
        await ensureJobQueue()
    }
    nitroApp.hooks.hook('close', () => stopJobWorkers())
})
