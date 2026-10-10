import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Add a Drive folder or file as a knowledge source, or refresh its token and name when it's already
 * connected.
 *
 * @param input.driveItemId - Google Drive folder or file id.
 * @param input.kind - `folder` or `file`.
 * @param input.name - Its name in Drive.
 * @param input.connectedById - The user whose Google access reads it.
 * @param input.refreshTokenEncrypted - Their encrypted refresh token (drive.readonly).
 * @returns The source row.
 */
export function upsertKnowledgeSource({
    driveItemId,
    kind,
    name,
    connectedById,
    refreshTokenEncrypted,
}: {
    driveItemId: string
    kind: 'folder' | 'file'
    name: string
    connectedById: string
    refreshTokenEncrypted: string
}) {
    const fields = {
        kind,
        name,
        connected_by_id: connectedById,
        refresh_token_encrypted: refreshTokenEncrypted,
        status: 'active',
        last_error: null,
    }
    return db().knowledgeSource.upsert({
        where: { drive_item_id: driveItemId },
        create: { id: newId({ kind: 'knowledgeSource' }), drive_item_id: driveItemId, ...fields },
        update: fields,
    })
}

/**
 * One knowledge source.
 *
 * @param input.knowledgeSourceId - The source.
 * @returns The source, or null.
 */
export function findKnowledgeSource({ knowledgeSourceId }: { knowledgeSourceId: string }) {
    return db().knowledgeSource.findUnique({ where: { id: knowledgeSourceId } })
}

/**
 * Every knowledge source with who connected it and its document counts.
 *
 * @returns Sources, oldest first.
 */
export function listKnowledgeSources() {
    return db().knowledgeSource.findMany({
        include: { connected_by: true, _count: { select: { documents: true } } },
        orderBy: { id: 'asc' },
    })
}

/**
 * Sources that can be synced.
 *
 * @returns Active sources.
 */
export function listActiveKnowledgeSources() {
    return db().knowledgeSource.findMany({ where: { status: 'active' } })
}

/**
 * Knowledge sources a user connected (their Google access reads them).
 *
 * @param input.userId - The user.
 * @returns Sources.
 */
export function listKnowledgeSourcesConnectedBy({ userId }: { userId: string }) {
    return db().knowledgeSource.findMany({ where: { connected_by_id: userId } })
}

/**
 * Record the outcome of a sync.
 *
 * @param input.knowledgeSourceId - The source.
 * @param input.lastSyncedAt - Set on success.
 * @param input.lastError - Set on failure (null clears it).
 * @param input.status - New status, if changing.
 * @returns The updated source.
 */
export function recordKnowledgeSync({
    knowledgeSourceId,
    lastSyncedAt,
    lastError,
    status,
}: {
    knowledgeSourceId: string
    lastSyncedAt?: Date
    lastError: string | null
    status?: 'active' | 'error'
}) {
    return db().knowledgeSource.update({
        where: { id: knowledgeSourceId },
        data: { last_synced_at: lastSyncedAt, last_error: lastError, status },
    })
}

/**
 * Remove a source and its documents.
 *
 * @param input.knowledgeSourceId - The source.
 * @returns Resolves once deleted.
 */
export async function deleteKnowledgeSource({ knowledgeSourceId }: { knowledgeSourceId: string }) {
    await db().knowledgeSource.delete({ where: { id: knowledgeSourceId } })
}

/**
 * Drive file ids and modified times already stored, to skip unchanged files.
 *
 * @returns Map of Drive file id → document id and modified time.
 */
export async function knowledgeDocumentVersions() {
    const rows = await db().knowledgeDocument.findMany({
        select: { id: true, drive_file_id: true, modified_at: true, status: true },
    })
    return new Map(rows.map(row => [row.drive_file_id, row]))
}

/**
 * Save one synced file. Pin and exclude choices are kept across syncs.
 *
 * @param input.sourceId - The source it came from.
 * @param input.driveFileId - Drive file id.
 * @param input.name - File name.
 * @param input.mimeType - Drive MIME type.
 * @param input.webViewLink - Link to open it in Drive.
 * @param input.modifiedAt - Drive's modified time.
 * @param input.status - `indexed`, `unsupported`, `too_large`, `failed` or `sensitive`.
 * @param input.text - Extracted text, when indexed.
 * @param input.sensitiveReason - Why it was skipped as sensitive.
 * @param input.syncedAt - When it was synced.
 * @returns The document row.
 */
export function upsertKnowledgeDocument({
    sourceId,
    driveFileId,
    name,
    mimeType,
    webViewLink,
    modifiedAt,
    status,
    text,
    sensitiveReason = null,
    syncedAt,
}: {
    sourceId: string
    driveFileId: string
    name: string
    mimeType: string
    webViewLink: string | null
    modifiedAt: Date
    status: string
    text: string | null
    sensitiveReason?: string | null
    syncedAt: Date
}) {
    const fields = {
        source_id: sourceId,
        name,
        mime_type: mimeType,
        web_view_link: webViewLink,
        modified_at: modifiedAt,
        status,
        text,
        sensitive_reason: sensitiveReason,
        char_count: text?.length ?? 0,
        synced_at: syncedAt,
    }
    return db().knowledgeDocument.upsert({
        where: { drive_file_id: driveFileId },
        create: { id: newId({ kind: 'knowledgeDocument' }), drive_file_id: driveFileId, ...fields },
        update: fields,
    })
}

/**
 * Mark unchanged files as seen in this sync (and move them to this source if a folder overlaps).
 *
 * @param input.sourceId - The source being synced.
 * @param input.driveFileIds - Files that are unchanged.
 * @param input.syncedAt - When it was synced.
 * @returns Resolves once updated.
 */
export async function touchKnowledgeDocuments({
    sourceId,
    driveFileIds,
    syncedAt,
}: {
    sourceId: string
    driveFileIds: string[]
    syncedAt: Date
}) {
    await db().knowledgeDocument.updateMany({
        where: { drive_file_id: { in: driveFileIds } },
        data: { source_id: sourceId, synced_at: syncedAt },
    })
}

/**
 * Delete a source's documents that are no longer in its folder.
 *
 * @param input.sourceId - The source.
 * @param input.keepDriveFileIds - Files still present.
 * @returns The number deleted.
 */
export async function deleteMissingKnowledgeDocuments({
    sourceId,
    keepDriveFileIds,
}: {
    sourceId: string
    keepDriveFileIds: string[]
}) {
    const result = await db().knowledgeDocument.deleteMany({
        where: { source_id: sourceId, drive_file_id: { notIn: keepDriveFileIds } },
    })
    return result.count
}

/**
 * Every document, without its text, for Settings.
 *
 * @returns Documents, pinned first, then by name.
 */
export function listKnowledgeDocuments() {
    return db().knowledgeDocument.findMany({
        omit: { text: true },
        orderBy: [{ is_pinned: 'desc' }, { name: 'asc' }],
    })
}

/**
 * Documents the AI may read: indexed and not excluded, with their text.
 *
 * @returns Documents in a stable order (so prompts stay cacheable).
 */
export function listUsableKnowledgeDocuments() {
    return db().knowledgeDocument.findMany({
        where: { status: 'indexed', is_excluded: false, text: { not: null } },
        select: { id: true, name: true, web_view_link: true, text: true, is_pinned: true },
        orderBy: { id: 'asc' },
    })
}

/**
 * One document without its text.
 *
 * @param input.knowledgeDocumentId - The document.
 * @returns The document, or null.
 */
export function findKnowledgeDocument({ knowledgeDocumentId }: { knowledgeDocumentId: string }) {
    return db().knowledgeDocument.findUnique({ where: { id: knowledgeDocumentId }, omit: { text: true } })
}

/**
 * Pin or exclude a document.
 *
 * @param input.knowledgeDocumentId - The document.
 * @param input.isPinned - Always give it to the AI in full.
 * @param input.isExcluded - Never give it to the AI.
 * @returns The updated document, without its text.
 */
export function updateKnowledgeDocument({
    knowledgeDocumentId,
    isPinned,
    isExcluded,
}: {
    knowledgeDocumentId: string
    isPinned?: boolean
    isExcluded?: boolean
}) {
    return db().knowledgeDocument.update({
        where: { id: knowledgeDocumentId },
        data: { is_pinned: isPinned, is_excluded: isExcluded },
        omit: { text: true },
    })
}

/**
 * A source's readable documents with their text, to re-check them for sensitive content.
 *
 * @param input.sourceId - The source.
 * @returns Id, name and text.
 */
export function listIndexedKnowledgeTexts({ sourceId }: { sourceId: string }) {
    return db().knowledgeDocument.findMany({
        where: { source_id: sourceId, status: 'indexed' },
        select: { id: true, name: true, text: true },
    })
}

/**
 * Mark a document sensitive and delete its stored text.
 *
 * @param input.knowledgeDocumentId - The document.
 * @param input.reason - Why it's sensitive.
 * @returns Resolves once updated.
 */
export async function markKnowledgeDocumentSensitive({
    knowledgeDocumentId,
    reason,
}: {
    knowledgeDocumentId: string
    reason: string
}) {
    await db().knowledgeDocument.update({
        where: { id: knowledgeDocumentId },
        data: { status: 'sensitive', sensitive_reason: reason, text: null, char_count: 0, is_pinned: false },
    })
}
