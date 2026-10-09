import { createReadStream } from 'node:fs'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { ensureDataDirectory } from '#server/utils/config.ts'

// Local disk under DATA_DIR/files for now; an S3/R2 implementation can replace these functions
// without touching callers, because everything goes through relative keys.

/**
 * The absolute path for a storage key, refusing keys that escape the storage root.
 *
 * @param input.key - Relative key such as `tasks/tsk_…/att_…/report.pdf`.
 * @returns The absolute path.
 * @throws Error when the key is absolute or climbs out of the root.
 */
export function storagePath({ key }: { key: string }) {
    const root = ensureDataDirectory({ relativePath: 'files' })
    const path = resolve(root, key)
    if (!path.startsWith(root + sep)) {
        throw new Error(`Storage key escapes the storage root: ${key}`)
    }
    return path
}

/**
 * Write a file.
 *
 * @param input.key - Relative storage key.
 * @param input.data - File contents.
 * @returns Resolves once written.
 */
export async function putFile({ key, data }: { key: string; data: Uint8Array }) {
    const path = storagePath({ key })
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
}

/**
 * Stream a stored file.
 *
 * @param input.key - Relative storage key.
 * @returns A readable stream.
 */
export function streamFile({ key }: { key: string }) {
    return createReadStream(storagePath({ key }))
}

/**
 * Whether a stored file exists.
 *
 * @param input.key - Relative storage key.
 * @returns True when the file exists.
 */
export async function fileExists({ key }: { key: string }) {
    try {
        await access(storagePath({ key }))
        return true
    } catch {
        return false
    }
}

/**
 * Delete a stored file (no error when it's already gone).
 *
 * @param input.key - Relative storage key.
 * @returns Resolves once deleted.
 */
export async function deleteStoredFile({ key }: { key: string }) {
    await rm(storagePath({ key }), { force: true })
}

/**
 * A filename that is safe to use in a storage key and a Content-Disposition header.
 *
 * @param input.filename - Name as uploaded.
 * @returns A cleaned name (letters, digits, dot, dash, underscore), never empty.
 */
export function safeFilename({ filename }: { filename: string }) {
    const base = filename.split(/[/\\]/).at(-1) ?? ''
    const cleaned = base
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120)
    return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'file'
}
