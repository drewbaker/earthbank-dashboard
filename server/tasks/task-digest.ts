import { defineTask } from 'nitropack/runtime'
import { config } from '#server/utils/config.ts'
import { sendTaskDigests } from '#server/utils/notifications.ts'

export default defineTask({
    meta: {
        name: 'task-digest',
        description: 'Email each person their tasks that are overdue or due within a week',
    },
    async run() {
        if (!config.runBackgroundWorkers) {
            return { result: 'skipped (workers disabled on this instance)' }
        }
        const digests = await sendTaskDigests({ now: new Date() })
        return { result: `queued ${digests} digests` }
    },
})
