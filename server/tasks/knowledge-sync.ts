import { defineTask } from 'nitropack/runtime'
import { listActiveKnowledgeSources } from '#server/database/knowledge.ts'
import { config } from '#server/utils/config.ts'
import { enqueueKnowledgeSync } from '#server/utils/jobs/enqueue.ts'

export default defineTask({
    meta: {
        name: 'knowledge-sync',
        description: 'Queue a sync of every connected Drive knowledge folder',
    },
    async run() {
        if (!config.runBackgroundWorkers) {
            return { result: 'skipped (workers disabled on this instance)' }
        }
        const sources = await listActiveKnowledgeSources()
        for (const source of sources) {
            await enqueueKnowledgeSync({ knowledgeSourceId: source.id })
        }
        return { result: `queued ${sources.length} knowledge syncs` }
    },
})
