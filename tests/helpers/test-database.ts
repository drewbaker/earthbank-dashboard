import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Point DATA_DIR at a fresh temp folder and apply every migration to a new database there.
 *
 * Call before dynamically importing any `#server/…` module, so the lazily created Prisma client
 * opens the test database.
 *
 * @returns The temp folder and a cleanup function for `afterAll`.
 */
export function setupTestDatabase() {
    const dataDir = mkdtempSync(join(tmpdir(), 'earthbank-dashboard-test-'))
    process.env.DATA_DIR = dataDir
    process.env.NITRO_RUN_BACKGROUND_WORKERS = 'false'
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' })

    /**
     * Close the database and delete the temp folder.
     *
     * @returns Resolves once everything is removed.
     */
    async function cleanupTestDatabase() {
        const { disconnectDatabase } = await import('#server/utils/db.ts')
        await disconnectDatabase()
        rmSync(dataDir, { recursive: true, force: true })
    }

    return { dataDir, cleanupTestDatabase }
}
