import { defineRouteMeta } from 'nitropack/runtime'
import { listKnowledgeSources } from '#server/database/knowledge.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeKnowledgeSource } from '#server/utils/serializers/knowledge.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Knowledge'],
        summary: 'List connected Drive folders',
        description: 'Google Drive folders whose documents inform AI-drafted emails.',
        responses: {
            200: {
                description: 'Folders',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/KnowledgeSourceList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const sources = await listKnowledgeSources()
    return {
        data: sources.map(source => serializeKnowledgeSource({ source })),
        next_cursor: null,
        has_more: false,
    }
})
