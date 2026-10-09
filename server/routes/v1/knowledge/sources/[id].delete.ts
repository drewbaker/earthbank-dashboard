import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { deleteKnowledgeSource, findKnowledgeSource } from '#server/database/knowledge.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { decryptSecret } from '#server/utils/crypto.ts'
import { notFound } from '#server/utils/errors.ts'
import { revokeGoogleAccessIfUnused } from '#server/utils/google-access.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Knowledge'],
        summary: 'Disconnect a Drive folder',
        description:
            "Deletes the folder's synced documents and stored token. Google access is revoked when nothing else of the person who connected it uses it.",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Disconnected' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const knowledgeSourceId = getRouterParam(event, 'id') ?? ''
    const source = await findKnowledgeSource({ knowledgeSourceId })
    if (!source) {
        throw notFound({ resource: 'Folder' })
    }
    await deleteKnowledgeSource({ knowledgeSourceId })
    const refreshToken = source.refresh_token_encrypted
        ? decryptSecret({ encrypted: source.refresh_token_encrypted })
        : null
    if (refreshToken && source.connected_by_id) {
        await revokeGoogleAccessIfUnused({ userId: source.connected_by_id, refreshToken })
    }
    await recordAudit({
        actor: ctx.actor,
        action: 'knowledge_source.disconnected',
        entityType: 'knowledge_source',
        entityId: knowledgeSourceId,
        changes: { name: source.name },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
