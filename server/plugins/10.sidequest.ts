import { defineNitroPlugin } from 'nitropack/runtime'
import { config } from '#server/utils/config.ts'
import { ensureJobQueue, startJobWorkers, stopJobWorkers } from '#server/utils/jobs/sidequest.ts'

export default defineNitroPlugin(async nitroApp => {
    if (config.runBackgroundWorkers) {
        await startJobWorkers({ rebuildBundle: import.meta.dev })
    } else {
        await ensureJobQueue()
    }
    nitroApp.hooks.hook('close', () => stopJobWorkers())
})
