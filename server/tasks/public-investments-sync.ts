import { defineTask } from 'nitropack/runtime'
import { config } from '#server/utils/config.ts'
import { PUBLIC_INVESTMENT_SOURCES } from '#server/utils/funds/public-investment-sources.ts'
import { readFundResearchSettings } from '#server/utils/funds/research-settings.ts'
import { enqueuePublicInvestmentSync } from '#server/utils/jobs/enqueue.ts'

export default defineTask({
    meta: {
        name: 'public-investments-sync',
        description: 'Queue a read of every public DFI and government investment list',
    },
    async run() {
        if (!config.runBackgroundWorkers) {
            return { result: 'skipped (workers disabled on this instance)' }
        }
        if (!config.anthropicApiKey || !(await readFundResearchSettings()).spider_enabled) {
            return { result: 'skipped (no API key, or the spider is paused)' }
        }
        for (const source of PUBLIC_INVESTMENT_SOURCES) {
            await enqueuePublicInvestmentSync({ sourceKey: source.key })
        }
        return { result: `queued ${PUBLIC_INVESTMENT_SOURCES.length} public list syncs` }
    },
})
