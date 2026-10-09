import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '#server/generated/prisma/client.ts'
import { config, ensureDataDirectory } from '#server/utils/config.ts'

let client: PrismaClient | undefined

/**
 * The process-wide Prisma client, created on first use.
 *
 * Lazy so importing a module that uses the database never opens a connection by itself, which keeps
 * scripts and tests in control of `DATA_DIR`.
 *
 * @returns The shared Prisma client.
 */
export function db() {
    if (!client) {
        ensureDataDirectory({ relativePath: 'db' })
        const adapter = new PrismaBetterSqlite3({ url: config.appDatabasePath, timeout: 5000 })
        client = new PrismaClient({ adapter })
    }
    return client
}

/**
 * Apply the SQLite pragmas the app relies on: WAL for concurrent readers, enforced foreign keys.
 *
 * @returns Resolves once both pragmas are set.
 */
export async function configureDatabase() {
    await db().$queryRawUnsafe('PRAGMA journal_mode = WAL')
    await db().$executeRawUnsafe('PRAGMA foreign_keys = ON')
}

/**
 * Close the shared client (used by tests and scripts before exit).
 *
 * @returns Resolves once the connection is closed.
 */
export async function disconnectDatabase() {
    if (client) {
        await client.$disconnect()
        client = undefined
    }
}
