import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Sidequest } from 'sidequest'
import type { SidequestEngineConfig } from 'sidequest'
import { config, ensureDataDirectory } from '#server/utils/config.ts'
import { bundleJobs } from '#server/utils/jobs/bundle.ts'

export { Sidequest }

// Small, explicit concurrency: SQLite has a single writer.
const QUEUES = [
    { name: 'default', concurrency: 2 },
    { name: 'email', concurrency: 2 },
]

let readiness: Promise<void> | undefined

/**
 * Where the worker bundle of `sidequest.jobs.ts` lives: `.output/server` after a production build,
 * `.nuxt` in development, scripts and tests.
 *
 * @returns Absolute path of the bundle.
 */
export function jobsBundlePath() {
    return config.isProduction
        ? resolve(process.cwd(), '.output/server/sidequest.jobs.mjs')
        : resolve(process.cwd(), '.nuxt/sidequest.jobs.mjs')
}

/**
 * Engine settings shared by workers and enqueue-only processes. Both must use manual job resolution
 * so queued jobs point at the same bundle.
 *
 * @returns The Sidequest engine config.
 */
function engineConfig(): SidequestEngineConfig {
    ensureDataDirectory({ relativePath: 'db' })
    return {
        backend: { driver: '@sidequest/sqlite-backend', config: config.jobsDatabasePath },
        queues: QUEUES,
        manualJobResolution: true,
        jobsFilePath: jobsBundlePath(),
        logger: { level: 'warn' },
    }
}

/**
 * Start Sidequest with workers and its dashboard (proxied at /admin/jobs).
 *
 * @param input.rebuildBundle - Rebuild the jobs bundle first (development, so job edits apply on restart).
 * @returns Resolves once workers are running.
 */
export function startJobWorkers({ rebuildBundle }: { rebuildBundle: boolean }) {
    readiness ??= (async () => {
        if (rebuildBundle || !existsSync(jobsBundlePath())) {
            await bundleJobs({ outfile: jobsBundlePath() })
        }
        await Sidequest.start({
            ...engineConfig(),
            dashboard: {
                enabled: true,
                port: config.sidequestDashboardPort,
                basePath: '/admin/jobs',
                auth: { user: config.sidequestDashboardUser, password: config.sidequestDashboardPassword },
            },
        })
        console.info('[jobs] Sidequest workers started')
    })()
    return readiness
}

/**
 * Make sure this process can enqueue jobs. Configures Sidequest without workers unless the Nitro
 * plugin already started them.
 *
 * @returns Resolves once enqueueing is possible.
 */
export function ensureJobQueue() {
    readiness ??= (async () => {
        if (!existsSync(jobsBundlePath()) && !config.isProduction) {
            await bundleJobs({ outfile: jobsBundlePath() })
        }
        await Sidequest.configure(engineConfig())
    })()
    return readiness
}

/**
 * Stop workers and the dashboard (Nitro `close` hook).
 *
 * @returns Resolves once Sidequest has stopped.
 */
export async function stopJobWorkers() {
    if (readiness) {
        await Sidequest.stop()
        readiness = undefined
    }
}
