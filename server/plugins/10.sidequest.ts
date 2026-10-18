import { defineNitroPlugin } from 'nitropack/runtime'
import { config } from '#server/utils/config.ts'
import { queueFirstPublicListSyncs, resumeFundResearch } from '#server/utils/funds/resume.ts'
import { ensureSeedFunds } from '#server/utils/funds/seed.ts'
import { enqueueBookkeepingSync } from '#server/utils/jobs/enqueue.ts'
import { ensureJobQueue, startJobWorkers, stopJobWorkers } from '#server/utils/jobs/sidequest.ts'

export default defineNitroPlugin(async nitroApp => {
    if (config.runBackgroundWorkers) {
        await startJobWorkers({ rebuildBundle: import.meta.dev })
        // Sync bank data right after a deploy instead of waiting up to an hour for the schedule.
        if (config.bookkeepingApiKey) {
            await enqueueBookkeepingSync().catch(error => console.error('[bookkeeping] startup sync not queued', error))
        }
        // First run: the seed lenders go on the Funds list and their research is queued. After a deploy,
        // research jobs lost in the restart are queued again.
        startFundResearch().catch(error => console.error('[research] seeding or resuming fund research failed', error))
    } else {
        await ensureJobQueue()
    }
    nitroApp.hooks.hook('close', () => stopJobWorkers())
})

/**
 * On first run: queue the public lists and seed the Funds list. On later starts, queue research that a
 * restart interrupted.
 *
 * @returns Resolves once queued.
 */
async function startFundResearch() {
    const lists = await queueFirstPublicListSyncs()
    if (lists > 0) {
        console.info(`[research] queued a first read of ${lists} public investment lists`)
    }
    const seeded = await ensureSeedFunds({ now: new Date() })
    if (seeded > 0) {
        console.info(`[research] added ${seeded} seed funds`)
        return
    }
    const resumed = await resumeFundResearch({ now: new Date() })
    if (resumed > 0) {
        console.info(`[research] queued ${resumed} interrupted fund research jobs`)
    }
}
