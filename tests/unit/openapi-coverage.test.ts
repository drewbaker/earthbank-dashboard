// Fails when a /v1 route is missing defineRouteMeta, so the API reference never silently drifts.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTES_DIRECTORY = join(process.cwd(), 'server/routes/v1')

/**
 * List every route file below a folder.
 *
 * @param input.directory - Folder to walk.
 * @returns Absolute file paths.
 */
function listRouteFiles({ directory }: { directory: string }): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name)
        return entry.isDirectory() ? listRouteFiles({ directory: path }) : [path]
    })
}

describe('OpenAPI coverage', () => {
    it('every /v1 route declares defineRouteMeta', () => {
        const missing = listRouteFiles({ directory: ROUTES_DIRECTORY })
            .filter(path => !path.endsWith('[...path].ts'))
            .filter(path => !readFileSync(path, 'utf8').includes('defineRouteMeta('))
            .map(path => relative(process.cwd(), path))
        expect(missing).toEqual([])
    })
})
