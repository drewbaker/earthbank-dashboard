import { existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { config, ensureDataDirectory } from '#server/utils/config.ts'

const BACKUPS_KEPT = 7

/**
 * Snapshot `app.db` and `jobs.db` with `VACUUM INTO`, then keep only the newest snapshots.
 *
 * `VACUUM INTO` produces a consistent copy while the app keeps writing, unlike copying the file.
 *
 * @param input.now - Timestamp used in the snapshot folder name.
 * @returns The folder the snapshots were written to.
 */
export function backupDatabases({ now }: { now: Date }) {
    const backupsDirectory = ensureDataDirectory({ relativePath: 'backups' })
    const snapshotDirectory = ensureDataDirectory({
        relativePath: `backups/${now.toISOString().replace(/[:.]/g, '-')}`,
    })
    for (const databasePath of [config.appDatabasePath, config.jobsDatabasePath]) {
        if (!existsSync(databasePath)) {
            continue
        }
        const database = new Database(databasePath, { readonly: true })
        try {
            const target = resolve(snapshotDirectory, databasePath.split('/').at(-1)!)
            database.prepare('VACUUM INTO ?').run(target)
        } finally {
            database.close()
        }
    }
    pruneOldBackups({ backupsDirectory })
    return snapshotDirectory
}

/**
 * Delete all but the newest snapshot folders. Folder names are ISO timestamps, so they sort by age.
 *
 * @param input.backupsDirectory - The `DATA_DIR/backups` folder.
 * @returns The number of folders deleted.
 */
function pruneOldBackups({ backupsDirectory }: { backupsDirectory: string }) {
    const snapshots = readdirSync(backupsDirectory, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
    const expired = snapshots.slice(0, Math.max(0, snapshots.length - BACKUPS_KEPT))
    for (const name of expired) {
        rmSync(resolve(backupsDirectory, name), { recursive: true, force: true })
    }
    return expired.length
}
