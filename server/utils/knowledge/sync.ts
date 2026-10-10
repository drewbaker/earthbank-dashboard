import {
    deleteMissingKnowledgeDocuments,
    findKnowledgeSource,
    knowledgeDocumentVersions,
    listIndexedKnowledgeTexts,
    markKnowledgeDocumentSensitive,
    recordKnowledgeSync,
    touchKnowledgeDocuments,
    upsertKnowledgeDocument,
} from '#server/database/knowledge.ts'
import { decryptSecret } from '#server/utils/crypto.ts'
import type { DriveFile, KnowledgeDrive } from '#server/utils/knowledge/drive.ts'
import { GoogleKnowledgeDrive } from '#server/utils/knowledge/drive.ts'
import { contentPlan, extractText } from '#server/utils/knowledge/extract.ts'
import { sensitiveReasonFromName, sensitiveReasonFromText } from '#server/utils/knowledge/sensitive.ts'

const MAX_FILE_BYTES = 20 * 1024 * 1024

export type KnowledgeSyncSummary = {
    files: number
    indexed: number
    unchanged: number
    unsupported: number
    failed: number
    sensitive: number
    removed: number
}

/**
 * Bring one source's documents up to date (a folder's files, or the one connected file): new and
 * changed files are downloaded and their text extracted; unchanged files are skipped; files no longer
 * in the folder are removed.
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
            lastError: `The stored Google access could not be read. Reconnect the ${source.kind}.`,
            status: 'error',
        })
        return { skipped: 'no usable token' }
    }
    const client = drive ?? new GoogleKnowledgeDrive({ refreshToken: refreshToken! })

    try {
        const files =
            source.kind === 'file'
                ? await connectedFile({ drive: client, itemId: source.drive_item_id })
                : await client.listFiles({ folderId: source.drive_item_id })
        const versions = await knowledgeDocumentVersions()
        const summary: KnowledgeSyncSummary = {
            files: files.length,
            indexed: 0,
            unchanged: 0,
            unsupported: 0,
            failed: 0,
            sensitive: 0,
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
            summary[
                status === 'indexed'
                    ? 'indexed'
                    : status === 'failed'
                      ? 'failed'
                      : status === 'sensitive'
                        ? 'sensitive'
                        : 'unsupported'
            ]++
        }
        await touchKnowledgeDocuments({ sourceId: source.id, driveFileIds: unchangedIds, syncedAt: now })
        // Documents read before the sensitive check existed (or before its rules changed) get checked too.
        summary.sensitive += await scrubSensitiveDocuments({ sourceId: source.id })
        summary.removed = await deleteMissingKnowledgeDocuments({
            sourceId: source.id,
            keepDriveFileIds: files.map(file => file.id),
        })
        await recordKnowledgeSync({ knowledgeSourceId, lastSyncedAt: now, lastError: null })
        console.info('[knowledge] synced', knowledgeSourceId, JSON.stringify(summary))
        return summary
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // invalid_grant: access was revoked or expired; 404: the folder or file was deleted or unshared.
        const isRevoked = /invalid_grant|unauthorized_client/i.test(message)
        const isGone = (error as { status?: number })?.status === 404
        await recordKnowledgeSync({
            knowledgeSourceId,
            lastError: isRevoked
                ? `Google access was revoked or expired. Reconnect the ${source.kind}.`
                : isGone
                  ? `The ${source.kind} was not found. It may have been deleted or unshared.`
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
 * The one file a file source is about, as a list like a folder's.
 *
 * @param input.drive - Drive client.
 * @param input.itemId - The file's id.
 * @returns The file.
 * @throws An error with status 404 when it's gone, unshared or no longer a file.
 */
async function connectedFile({ drive, itemId }: { drive: KnowledgeDrive; itemId: string }) {
    const item = await drive.getItem({ itemId })
    if (!item?.file) {
        throw Object.assign(new Error('Drive file not found'), { status: 404 })
    }
    return [item.file]
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
    // A sensitive-looking name is never downloaded.
    let sensitiveReason = sensitiveReasonFromName({ name: file.name })
    if (sensitiveReason) {
        status = 'sensitive'
    } else if (plan && file.sizeBytes !== null && file.sizeBytes > MAX_FILE_BYTES) {
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
            sensitiveReason = sensitiveReasonFromText({ text })
            status = sensitiveReason ? 'sensitive' : 'indexed'
            text = sensitiveReason ? null : text
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
        sensitiveReason,
        syncedAt: now,
    })
    return status
}

/**
 * Re-check a source's readable documents against the sensitive rules, deleting the text of any match.
 *
 * @param input.sourceId - The source.
 * @returns How many documents were newly marked sensitive.
 */
async function scrubSensitiveDocuments({ sourceId }: { sourceId: string }) {
    let marked = 0
    for (const document of await listIndexedKnowledgeTexts({ sourceId })) {
        const reason =
            sensitiveReasonFromName({ name: document.name }) ?? sensitiveReasonFromText({ text: document.text ?? '' })
        if (reason) {
            await markKnowledgeDocumentSensitive({ knowledgeDocumentId: document.id, reason })
            marked++
        }
    }
    return marked
}
