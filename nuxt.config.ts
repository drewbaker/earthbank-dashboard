import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineNuxtConfig } from 'nuxt/config'
import { bundleJobs } from '#server/utils/jobs/bundle.ts'

// Shared TypeScript options for every generated tsconfig: `.ts` extensions on internal imports, and
// the Prisma client is generated as TypeScript with `.ts` imports.
const compilerOptions = { allowImportingTsExtensions: true, noEmit: true }

export default defineNuxtConfig({
    compatibilityDate: '2026-10-08',
    devtools: { enabled: true },
    modules: ['@nuxt/ui', 'nuxt-charts'],
    css: ['~/assets/css/main.css'],

    // App: no auto-imported composables, utils or Vue APIs.
    imports: { autoImport: false },

    app: {
        head: {
            title: 'Earth Bank Dashboard',
            htmlAttrs: { lang: 'en' },
            link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
        },
    },

    ui: {
        theme: {
            colors: ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'],
        },
    },

    fonts: {
        families: [{ name: 'Public Sans', provider: 'google', weights: [400, 500, 600, 700] }],
    },

    routeRules: {
        '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
        '/**': { headers: { 'cache-control': 'private, no-store' } },
    },

    typescript: {
        strict: true,
        tsConfig: { compilerOptions },
        sharedTsConfig: { compilerOptions },
        nodeTsConfig: { compilerOptions },
    },

    nitro: {
        preset: 'node-server',
        // Server: no auto-imported h3 helpers or server/utils exports.
        imports: false,
        typescript: { tsConfig: { compilerOptions } },
        experimental: { openAPI: true, tasks: true },
        scheduledTasks: {
            '0 * * * *': ['cleanup'],
            '15 * * * *': ['bookkeeping-sync'],
            '*/15 * * * *': ['mail-sync'],
            // 03:00 UTC is overnight across the US.
            '0 3 * * *': ['backup'],
            // 13:00 UTC is early morning on the US east coast (9am EDT / 8am EST), weekdays only.
            '0 13 * * 1-5': ['task-digest'],
        },
        openAPI: {
            production: 'runtime',
            route: '/_openapi.json',
            meta: {
                title: 'Earth Bank Dashboard API',
                description: readFileSync(resolve(import.meta.dirname, 'docs/api-guide.md'), 'utf8'),
                version: '1.0.0',
            },
            ui: { scalar: { route: '/_scalar' }, swagger: false },
        },
        // Sidequest loads its driver, migrations and dashboard from disk at runtime, which tracing
        // misses. Render runs .output from the build checkout, so packages resolve from node_modules.
        externals: { trace: false },
        hooks: {
            // Worker threads import a standalone bundle of sidequest.jobs.ts (see server/utils/jobs/).
            async compiled(nitro) {
                if (!nitro.options.dev) {
                    await bundleJobs({ outfile: resolve(nitro.options.output.serverDir, 'sidequest.jobs.mjs') })
                }
            },
        },
    },
})
