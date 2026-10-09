import { resolve } from 'node:path'

/**
 * Bundle `sidequest.jobs.ts` into one ESM file that Sidequest's worker threads can import.
 *
 * Our `#` aliases and `.ts` imports are resolved by esbuild; every npm package (Prisma, Sidequest,
 * native modules) stays external and loads from node_modules at runtime. `keepNames` matters because
 * Sidequest finds job classes by name.
 *
 * @param input.outfile - Absolute path of the bundle to write.
 * @returns Resolves once the bundle is written.
 */
export async function bundleJobs({ outfile }: { outfile: string }) {
    const { build } = await import('esbuild')
    await build({
        entryPoints: [resolve(process.cwd(), 'sidequest.jobs.ts')],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        keepNames: true,
        sourcemap: 'inline',
        logLevel: 'warning',
        plugins: [
            {
                name: 'external-packages',
                setup(builder) {
                    // Bare specifiers are npm packages or node builtins; '#' aliases and paths get bundled.
                    builder.onResolve({ filter: /^[^.#/]/ }, args => ({ path: args.path, external: true }))
                },
            },
        ],
    })
}
