import { drive, type drive_v3 } from '@googleapis/drive'
import { googleOAuthClient } from '#server/utils/auth/google.ts'

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const MAX_FOLDER_DEPTH = 6
const MAX_FILES_PER_SOURCE = 500

export type DriveFile = {
    id: string
    name: string
    mimeType: string
    modifiedAt: Date
    webViewLink: string | null
    sizeBytes: number | null
}

/** A connected Drive item: a folder (everything inside it is read) or one file. */
export type DriveItem = { id: string; name: string; kind: 'folder' | 'file'; file: DriveFile | null }

/** What syncing needs from Drive; tests pass a fake. */
export interface KnowledgeDrive {
    getItem(input: { itemId: string }): Promise<DriveItem | null>
    listFiles(input: { folderId: string }): Promise<DriveFile[]>
    exportFile(input: { fileId: string; mimeType: string }): Promise<Uint8Array>
    downloadFile(input: { fileId: string }): Promise<Uint8Array>
}

/**
 * Pull a Drive id out of what someone pasted: a folder or file link (Drive, Docs, Sheets, Slides) or a
 * bare id. Whether it's a folder or a file is checked with Drive when it's connected.
 *
 * @param input.value - e.g. `https://drive.google.com/drive/folders/1AbC…?usp=sharing` or
 *   `https://docs.google.com/document/d/1AbC…/edit`.
 * @returns The id, or null when it doesn't look like one.
 */
export function parseDriveItemId({ value }: { value: string }) {
    const trimmed = value.trim()
    const fromUrl =
        trimmed.match(/\/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ??
        trimmed.match(/\/d\/([A-Za-z0-9_-]{10,})/)?.[1] ??
        trimmed.match(/[?&]id=([A-Za-z0-9_-]{10,})/)?.[1]
    const id = fromUrl ?? trimmed
    return /^[A-Za-z0-9_-]{10,200}$/.test(id) ? id : null
}

/**
 * Read-only access to Google Drive, authorized by one person's refresh token (drive.readonly).
 * Only connected files, and connected folders and the folders inside them, are ever read.
 */
export class GoogleKnowledgeDrive implements KnowledgeDrive {
    private readonly api: drive_v3.Drive

    /**
     * @param input.refreshToken - Decrypted refresh token with `drive.readonly`.
     */
    constructor({ refreshToken }: { refreshToken: string }) {
        const auth = googleOAuthClient()
        auth.setCredentials({ refresh_token: refreshToken })
        this.api = drive({ version: 'v3', auth })
    }

    /**
     * A folder or file, checking it exists and is readable.
     *
     * @param input.itemId - Drive folder or file id.
     * @returns The item (with the file's details when it's a file), or null when it can't be read.
     */
    async getItem({ itemId }: { itemId: string }): Promise<DriveItem | null> {
        try {
            const { data } = await this.api.files.get({
                fileId: itemId,
                fields: 'id, name, mimeType, modifiedTime, webViewLink, size',
                supportsAllDrives: true,
            })
            if (!data.id) {
                return null
            }
            if (data.mimeType === FOLDER_MIME_TYPE) {
                return { id: data.id, name: data.name ?? 'Folder', kind: 'folder', file: null }
            }
            if (data.mimeType === 'application/vnd.google-apps.shortcut') {
                return null
            }
            return {
                id: data.id,
                name: data.name ?? 'Untitled',
                kind: 'file',
                file: {
                    id: data.id,
                    name: data.name ?? 'Untitled',
                    mimeType: data.mimeType ?? 'application/octet-stream',
                    modifiedAt: new Date(data.modifiedTime ?? Date.now()),
                    webViewLink: data.webViewLink ?? null,
                    sizeBytes: data.size ? Number(data.size) : null,
                },
            }
        } catch (error) {
            if (isNotFound({ error })) {
                return null
            }
            throw error
        }
    }

    /**
     * Every file in the folder and its subfolders (breadth first, capped).
     *
     * @param input.folderId - Drive folder id.
     * @returns Files, without folders and shortcuts.
     */
    async listFiles({ folderId }: { folderId: string }) {
        const files: DriveFile[] = []
        let level = [folderId]
        for (let depth = 0; depth < MAX_FOLDER_DEPTH && level.length && files.length < MAX_FILES_PER_SOURCE; depth++) {
            const nextLevel: string[] = []
            for (const parentId of level) {
                for (const item of await this.listChildren({ parentId })) {
                    if (item.mimeType === FOLDER_MIME_TYPE) {
                        nextLevel.push(item.id!)
                    } else if (item.mimeType !== 'application/vnd.google-apps.shortcut') {
                        files.push({
                            id: item.id!,
                            name: item.name ?? 'Untitled',
                            mimeType: item.mimeType ?? 'application/octet-stream',
                            modifiedAt: new Date(item.modifiedTime ?? Date.now()),
                            webViewLink: item.webViewLink ?? null,
                            sizeBytes: item.size ? Number(item.size) : null,
                        })
                    }
                }
            }
            level = nextLevel
        }
        return files.slice(0, MAX_FILES_PER_SOURCE)
    }

    /**
     * Export a Google Docs, Sheets or Slides file.
     *
     * @param input.fileId - Drive file id.
     * @param input.mimeType - Export format.
     * @returns The exported bytes.
     */
    async exportFile({ fileId, mimeType }: { fileId: string; mimeType: string }) {
        const { data } = await this.api.files.export({ fileId, mimeType }, { responseType: 'arraybuffer' })
        return new Uint8Array(data as ArrayBuffer)
    }

    /**
     * Download an uploaded file (PDF, .xlsx, text).
     *
     * @param input.fileId - Drive file id.
     * @returns The file bytes.
     */
    async downloadFile({ fileId }: { fileId: string }) {
        const { data } = await this.api.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' },
        )
        return new Uint8Array(data as ArrayBuffer)
    }

    /**
     * Direct children of one folder, all pages.
     *
     * @param input.parentId - Folder id (validated by `parseDriveItemId` or returned by Drive).
     * @returns Files and folders.
     */
    private async listChildren({ parentId }: { parentId: string }) {
        const items: drive_v3.Schema$File[] = []
        let pageToken: string | undefined
        do {
            const { data } = await this.api.files.list({
                q: `'${parentId}' in parents and trashed = false`,
                fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size)',
                pageSize: 200,
                pageToken,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
            })
            items.push(...(data.files ?? []).filter(item => item.id))
            pageToken = data.nextPageToken ?? undefined
        } while (pageToken && items.length < MAX_FILES_PER_SOURCE)
        return items
    }
}

/**
 * Whether a Google API error is a 404.
 *
 * @param input.error - The thrown error.
 * @returns True for "not found".
 */
function isNotFound({ error }: { error: unknown }) {
    return (error as { status?: number; code?: number })?.status === 404 || (error as { code?: number })?.code === 404
}
