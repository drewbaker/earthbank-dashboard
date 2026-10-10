import type {
    KnowledgeDocument as KnowledgeDocumentRow,
    KnowledgeSource as KnowledgeSourceRow,
    User as UserRow,
} from '#server/generated/prisma/client.ts'
import { toIsoDateTime } from '#server/utils/dates.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import type { KnowledgeDocument, KnowledgeSource } from '#shared/schemas/index.ts'
import { KNOWLEDGE_DOCUMENT_STATUSES } from '#shared/schemas/knowledge.ts'

/**
 * A connected Drive folder, without its token.
 *
 * @param input.source - The source row with who connected it and its document count.
 * @returns The API shape.
 */
export function serializeKnowledgeSource({
    source,
}: {
    source: KnowledgeSourceRow & { connected_by: UserRow | null; _count: { documents: number } }
}): KnowledgeSource {
    return {
        id: source.id,
        drive_item_id: source.drive_item_id,
        name: source.name,
        kind: source.kind === 'file' ? 'file' : 'folder',
        drive_url:
            source.kind === 'file'
                ? `https://drive.google.com/file/d/${source.drive_item_id}/view`
                : `https://drive.google.com/drive/folders/${source.drive_item_id}`,
        status: source.status === 'error' ? 'error' : 'active',
        connected_by: serializeUserSummary({ user: source.connected_by }),
        document_count: source._count.documents,
        last_synced_at: toIsoDateTime({ date: source.last_synced_at }),
        last_error: source.last_error,
        created_at: toIsoDateTime({ date: source.created_at })!,
    }
}

/**
 * A synced document, without its text.
 *
 * @param input.document - The document row (text omitted).
 * @returns The API shape.
 */
export function serializeKnowledgeDocument({
    document,
}: {
    document: Omit<KnowledgeDocumentRow, 'text'>
}): KnowledgeDocument {
    const status = KNOWLEDGE_DOCUMENT_STATUSES.find(candidate => candidate === document.status) ?? 'failed'
    return {
        id: document.id,
        source_id: document.source_id,
        name: document.name,
        mime_type: document.mime_type,
        web_view_link: document.web_view_link,
        status,
        sensitive_reason: document.sensitive_reason,
        char_count: document.char_count,
        is_pinned: document.is_pinned,
        is_excluded: document.is_excluded,
        modified_at: toIsoDateTime({ date: document.modified_at })!,
        synced_at: toIsoDateTime({ date: document.synced_at })!,
    }
}
