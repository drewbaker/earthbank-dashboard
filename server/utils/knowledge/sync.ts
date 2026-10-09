import {
    deleteMissingKnowledgeDocuments,
    findKnowledgeSource,
    knowledgeDocumentVersions,
    recordKnowledgeSync,
    touchKnowledgeDocuments,
    upsertKnowledgeDocument,
} from '#server/database/knowledge.ts'
import { decryptSecret } from '#server/utils/crypto.ts'
import type { DriveFile, KnowledgeDrive } from '#server/utils/knowledge/drive.ts'
import { GoogleKnowledgeDrive } from '#server/utils/knowledge/drive.ts'
import { contentPlan, extractText } from '#server/utils/knowledge/extract.ts'

const MAX_FILE_BYTES = 20 * 1024 * 1024

export type KnowledgeSyncSummary = {
    files: number
    indexed: number
    unchanged: number
    unsupported: number
    failed: number
    removed: number
}

/**
 * Bring one Drive folder's documents up to date: new and changed files are downloaded and their
 * text extracted; unchanged files are skipped; files no longer in the folder are removed.
 *
 * @param input.knowledgeSourceId - The source.
 * @param input.now - Sync time.
 * @param input.drive - Drive client (tests); defaults to one built from the stored token.
 * @returns Counts, or a skip note when the source can't be read.
 */
export async function syncKnowledgeSource({
    knowledgeSourceId,
    now,
    drive,
}: {
    knowledgeSourceId: string
    now: Date
    drive?: KnowledgeDrive
}): Promise<KnowledgeSyncSummary | { skipped: string }> {
    const source = await findKnowledgeSource({ knowledgeSourceId })
    if (!source || source.status !== 'active') {
        return { skipped: 'source missing or needs reconnecting' }
    }
    const refreshToken = drive ? null : decryptSecret({ encrypted: source.refresh_token_encrypted })
    if (!drive && !refreshToken) {
        await recordKnowledgeSync({
            knowledgeSourceId,
            lastError: 'The stored Google access could not be read. Reconnect the folder.',
            status: 'error',
        })
        return { skipped: 'no usable token' }
    }
    const client = drive ?? new GoogleKnowledgeDrive({ refreshToken: refreshToken! })

    try {
        const files = await client.listFiles({ folderId: source.drive_folder_id })
        const versions = await knowledgeDocumentVersions()
        const summary: KnowledgeSyncSummary = {
            files: files.length,
            indexed: 0,
            unchanged: 0,
            unsupported: 0,
            failed: 0,
            removed: 0,
        }
        const unchangedIds: string[] = []
        for (const file of files) {
            const stored = versions.get(file.id)
            // Unchanged files are skipped, except ones that failed or that couldn't be read before but
            // can be now (support for a file type was added).
            const isRetryable =
                stored?.status === 'failed' ||
                (stored?.status === 'unsupported' && contentPlan({ mimeType: file.mimeType }) !== null)
            if (stored && stored.modified_at.getTime() === file.modifiedAt.getTime() && !isRetryable) {
                unchangedIds.push(file.id)
                summary.unchanged++
                continue
            }
            const status = await syncFile({ sourceId: source.id, file, drive: client, now })
            summary[status === 'indexed' ? 'indexed' : status === 'failed' ? 'failed' : 'unsupported']++
        }
        await touchKnowledgeDocuments({ sourceId: source.id, driveFileIds: unchangedIds, syncedAt: now })
        summary.removed = await deleteMissingKnowledgeDocuments({
            sourceId: source.id,
            keepDriveFileIds: files.map(file => file.id),
        })
        await recordKnowledgeSync({ knowledgeSourceId, lastSyncedAt: now, lastError: null })
        console.info('[knowledge] synced', knowledgeSourceId, JSON.stringify(summary))
        return summary
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // invalid_grant: access was revoked or expired; 404: the folder was deleted or unshared.
        const isRevoked = /invalid_grant|unauthorized_client/i.test(message)
        const isGone = (error as { status?: number })?.status === 404
        await recordKnowledgeSync({
            knowledgeSourceId,
            lastError: isRevoked
                ? 'Google access was revoked or expired. Reconnect the folder.'
                : isGone
                  ? 'The folder was not found. It may have been deleted or unshared.'
                  : message.slice(0, 500),
            status: isRevoked || isGone ? 'error' : undefined,
        })
        if (isRevoked || isGone) {
            return { skipped: 'source needs reconnecting' }
        }
        throw error
    }
}

/**
 * Download one new or changed file and store its text (or why it has none).
 *
 * @param input.sourceId - The source.
 * @param input.file - The Drive file.
 * @param input.drive - Drive client.
 * @param input.now - Sync time.
 * @returns The stored status.
 */
async function syncFile({
    sourceId,
    file,
    drive,
    now,
}: {
    sourceId: string
    file: DriveFile
    drive: KnowledgeDrive
    now: Date
}) {
    const plan = contentPlan({ mimeType: file.mimeType })
    let status = 'unsupported'
    let text: string | null = null
    if (plan && file.sizeBytes !== null && file.sizeBytes > MAX_FILE_BYTES) {
        status = 'too_large'
    } else if (plan) {
        try {
            const data =
                plan.action === 'export'
                    ? await drive.exportFile({ fileId: file.id, mimeType: plan.exportMimeType })
                    : await drive.downloadFile({ fileId: file.id })
            text = await extractText({
                data,
                contentMimeType: plan.action === 'export' ? plan.exportMimeType : plan.mimeType,
            })
            status = 'indexed'
        } catch (error) {
            // Drive refuses exports over 10 MB; anything else is logged by file id only.
            const message = error instanceof Error ? error.message : String(error)
            status = /exportSizeLimitExceeded|too large/i.test(message) ? 'too_large' : 'failed'
            console.info('[knowledge] file failed', file.id, message.slice(0, 200))
        }
    }
    await upsertKnowledgeDocument({
        sourceId,
        driveFileId: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        modifiedAt: file.modifiedAt,
        status,
        text,
        syncedAt: now,
    })
    return status
}
