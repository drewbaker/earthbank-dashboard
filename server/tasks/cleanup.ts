import { defineTask } from 'nitropack/runtime'
import { deleteExpiredSessions } from '#server/database/sessions.ts'
import { config } from '#server/utils/config.ts'

export default defineTask({
    meta: {
        name: 'cleanup',
        description: 'Delete expired sessions',
    },
    async run() {
        if (!config.runBackgroundWorkers) {
            return { result: 'skipped (workers disabled on this instance)' }
        }
        const deletedSessions = await deleteExpiredSessions({ now: new Date() })
        return { result: `deleted ${deletedSessions} expired sessions` }
    },
})
