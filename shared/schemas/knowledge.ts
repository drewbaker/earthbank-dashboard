import { z } from 'zod'
import { IsoDateTime, listOf, UserSummary } from '#shared/schemas/common.ts'

export const KNOWLEDGE_DOCUMENT_STATUSES = ['indexed', 'unsupported', 'too_large', 'failed', 'sensitive'] as const

export const KnowledgeSource = z.object({
    id: z.string(),
    drive_item_id: z.string(),
    /** A folder (everything inside it is read) or a single file. */
    kind: z.enum(['folder', 'file']),
    name: z.string(),
    drive_url: z.string(),
    status: z.enum(['active', 'error']),
    connected_by: UserSummary.nullable(),
    document_count: z.number().int(),
    last_synced_at: IsoDateTime.nullable(),
    last_error: z.string().nullable(),
    created_at: IsoDateTime,
})
export type KnowledgeSource = z.infer<typeof KnowledgeSource>

export const KnowledgeSourceList = listOf(KnowledgeSource)
export type KnowledgeSourceList = z.infer<typeof KnowledgeSourceList>

export const KnowledgeDocument = z.object({
    id: z.string(),
    source_id: z.string(),
    name: z.string(),
    mime_type: z.string(),
    web_view_link: z.string().nullable(),
    status: z.enum(KNOWLEDGE_DOCUMENT_STATUSES),
    /** Why it was skipped as sensitive (its text is never stored). */
    sensitive_reason: z.string().nullable(),
    char_count: z.number().int(),
    is_pinned: z.boolean(),
    is_excluded: z.boolean(),
    modified_at: IsoDateTime,
    synced_at: IsoDateTime,
})
export type KnowledgeDocument = z.infer<typeof KnowledgeDocument>

export const KnowledgeDocumentList = listOf(KnowledgeDocument)
export type KnowledgeDocumentList = z.infer<typeof KnowledgeDocumentList>

export const UpdateKnowledgeDocumentRequest = z.object({
    is_pinned: z.boolean().optional(),
    is_excluded: z.boolean().optional(),
})
export type UpdateKnowledgeDocumentRequest = z.infer<typeof UpdateKnowledgeDocumentRequest>
