import { defineTask } from 'nitropack/runtime'
import { backupDatabases } from '#server/utils/backup.ts'
import { config } from '#server/utils/config.ts'

export default defineTask({
    meta: {
        name: 'backup',
        description: 'Snapshot app.db and jobs.db into DATA_DIR/backups, keeping 7',
    },
    run() {
        if (!config.runBackgroundWorkers) {
            return { result: 'skipped (workers disabled on this instance)' }
        }
        const snapshotDirectory = backupDatabases({ now: new Date() })
        console.info('[backup] snapshot written', snapshotDirectory)
        return { result: `snapshot written to ${snapshotDirectory}` }
    },
})
