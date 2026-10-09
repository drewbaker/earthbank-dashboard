import { defineConfig } from 'prisma/config'
import { config, ensureDataDirectory } from '#server/utils/config.ts'

// The database path is derived from DATA_DIR so the app, scripts and the Prisma CLI always agree.
// `prisma generate` also loads this file during the Render build, before the disk is mounted, when
// DATA_DIR can't be created. Generating needs no database, so that failure is ignored; at start
// (`prisma migrate deploy`) the disk is mounted and the folder is created.
try {
    ensureDataDirectory({ relativePath: 'db' })
} catch (error) {
    console.info('[prisma] data directory not available yet:', error instanceof Error ? error.message : error)
}

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: `file:${config.appDatabasePath}`,
    },
})
