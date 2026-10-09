import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findKnowledgeDocument, updateKnowledgeDocument } from '#server/database/knowledge.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeKnowledgeDocument } from '#server/utils/serializers/knowledge.ts'
import { UpdateKnowledgeDocumentRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Knowledge'],
        summary: 'Pin or exclude a document',
        description:
            'Pinned documents are always given to the AI in full (e.g. the three-page explainer); excluded ones never are.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/UpdateKnowledgeDocumentRequest' } },
            },
        },
        responses: {
            200: {
                description: 'The document',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/KnowledgeDocument' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const knowledgeDocumentId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdateKnowledgeDocumentRequest })
    if (!(await findKnowledgeDocument({ knowledgeDocumentId }))) {
        throw notFound({ resource: 'Document' })
    }
    const document = await updateKnowledgeDocument({
        knowledgeDocumentId,
        isPinned: body.is_pinned,
        isExcluded: body.is_excluded,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'knowledge_document.updated',
        entityType: 'knowledge_document',
        entityId: knowledgeDocumentId,
        changes: body,
        ip: requestIp({ event }),
    })
    return serializeKnowledgeDocument({ document })
})
