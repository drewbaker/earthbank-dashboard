import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findKnowledgeSource } from '#server/database/knowledge.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { conflict, notFound } from '#server/utils/errors.ts'
import { enqueueKnowledgeSync } from '#server/utils/jobs/enqueue.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Knowledge'],
        summary: 'Sync a Drive folder now',
        description:
            'Queues a sync; new and changed documents are read within a few minutes. `status` is `already_queued` when a sync is already waiting or running.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 202: { description: 'Sync queued' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const knowledgeSourceId = getRouterParam(event, 'id') ?? ''
    const source = await findKnowledgeSource({ knowledgeSourceId })
    if (!source) {
        throw notFound({ resource: 'Folder' })
    }
    if (source.status !== 'active') {
        throw conflict({ message: 'Reconnect this folder before syncing it.' })
    }
    const status = await enqueueKnowledgeSync({ knowledgeSourceId })
    await recordAudit({
        actor: ctx.actor,
        action: 'knowledge_source.sync_requested',
        entityType: 'knowledge_source',
        entityId: knowledgeSourceId,
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 202)
    return { status }
})
