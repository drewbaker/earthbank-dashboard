import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

loadDotEnv()

/**
 * Load `.env` into `process.env` for scripts and tests.
 *
 * Node's loader never overrides variables that are already set, so real environment values win.
 *
 * @returns Nothing; `process.env` is updated in place.
 */
function loadDotEnv() {
    const envPath = resolve(process.cwd(), '.env')
    if (existsSync(envPath)) {
        process.loadEnvFile(envPath)
    }
}

/**
 * Read an environment variable, falling back to a default when it is unset or empty.
 *
 * @param name - Variable name.
 * @param fallback - Value used when the variable is unset or empty.
 * @returns The value, or the fallback (empty string when no fallback is given).
 */
function env(name: string, fallback = '') {
    const value = process.env[name]
    return value === undefined || value === '' ? fallback : value
}

/**
 * Read a positive integer environment variable.
 *
 * @param name - Variable name.
 * @param fallback - Value used when the variable is unset or not a positive integer.
 * @returns The parsed integer or the fallback.
 */
function envInt(name: string, fallback: number) {
    const parsed = Number.parseInt(env(name), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const config = {
    get isProduction() {
        return env('NODE_ENV') === 'production'
    },
    get appUrl() {
        return env('APP_URL', 'http://localhost:3000').replace(/\/$/, '')
    },
    get dataDir() {
        return resolve(process.cwd(), env('DATA_DIR', '.data'))
    },
    get appDatabasePath() {
        return resolve(this.dataDir, 'db/app.db')
    },
    get jobsDatabasePath() {
        return resolve(this.dataDir, 'db/jobs.db')
    },
    get sessionTtlDays() {
        return envInt('SESSION_TTL_DAYS', 7)
    },
    get googleClientId() {
        return env('GOOGLE_CLIENT_ID')
    },
    get googleClientSecret() {
        return env('GOOGLE_CLIENT_SECRET')
    },
    get googleWorkspaceDomain() {
        return env('GOOGLE_WORKSPACE_DOMAIN', 'theearthbank.org').toLowerCase()
    },
    get appEncryptionKey() {
        return env('APP_ENCRYPTION_KEY')
    },
    get resendApiKey() {
        return env('RESEND_API_KEY')
    },
    get emailFrom() {
        return env('EMAIL_FROM', 'Earth Bank Dashboard <noreply@mail.theearthbank.org>')
    },
    get runBackgroundWorkers() {
        return env('NITRO_RUN_BACKGROUND_WORKERS', 'true') === 'true'
    },
    get sidequestDashboardPort() {
        return envInt('SIDEQUEST_DASHBOARD_PORT', 8678)
    },
    get sidequestDashboardUser() {
        return env('SIDEQUEST_DASHBOARD_USER', 'admin')
    },
    get sidequestDashboardPassword() {
        return env('SIDEQUEST_DASHBOARD_PASSWORD', 'change-me')
    },
}

/**
 * Make sure a directory under `DATA_DIR` exists.
 *
 * @param input.relativePath - Path inside `DATA_DIR`, e.g. `db` or `backups`.
 * @returns The absolute directory path.
 */
export function ensureDataDirectory({ relativePath }: { relativePath: string }) {
    const directory = resolve(config.dataDir, relativePath)
    mkdirSync(directory, { recursive: true })
    return directory
}
