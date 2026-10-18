import { defineTask } from 'nitropack/runtime'
import { config } from '#server/utils/config.ts'
import { resumeFundResearch } from '#server/utils/funds/resume.ts'

export default defineTask({
    meta: {
        name: 'fund-research-resume',
        description: 'Queue research again for funds whose job was lost in a restart or paused by the budget',
    },
    async run() {
        if (!config.runBackgroundWorkers) {
            return { result: 'skipped (workers disabled on this instance)' }
        }
        return { result: `queued ${await resumeFundResearch({ now: new Date() })} fund research jobs` }
    },
})
