import { defineRouteMeta } from 'nitropack/runtime'
import { listKnowledgeDocuments } from '#server/database/knowledge.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeKnowledgeDocument } from '#server/utils/serializers/knowledge.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Knowledge'],
        summary: 'List synced Drive documents',
        description: 'Every document from the connected folders (without its text), pinned first.',
        responses: {
            200: {
                description: 'Documents',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/KnowledgeDocumentList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const documents = await listKnowledgeDocuments()
    return {
        data: documents.map(document => serializeKnowledgeDocument({ document })),
        next_cursor: null,
        has_more: false,
    }
})
