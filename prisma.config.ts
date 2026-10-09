import { defineConfig } from 'prisma/config'
import { config, ensureDataDirectory } from '#server/utils/config.ts'

// The database path is derived from DATA_DIR so the app, scripts and the Prisma CLI always agree.
ensureDataDirectory({ relativePath: 'db' })

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: `file:${config.appDatabasePath}`,
    },
})
