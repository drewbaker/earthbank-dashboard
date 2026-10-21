import { defineTask } from 'nitropack/runtime'
import { config } from '#server/utils/config.ts'
import { enqueueFundEmailActivityCheck } from '#server/utils/jobs/enqueue.ts'

export default defineTask({
    meta: {
        name: 'fund-email-activity',
        description: "Check connected Gmail for recent email with each fund's website domain (dates only)",
    },
    async run() {
        if (!config.runBackgroundWorkers) {
            return { result: 'skipped (workers disabled on this instance)' }
        }
        return { result: await enqueueFundEmailActivityCheck() }
    },
})
