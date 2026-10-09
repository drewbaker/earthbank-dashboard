import { defineTask } from 'nitropack/runtime'
import { listActiveMailboxConnections } from '#server/database/mailboxes.ts'
import { config } from '#server/utils/config.ts'
import { enqueueMailboxSync } from '#server/utils/jobs/enqueue.ts'

export default defineTask({
    meta: {
        name: 'mail-sync',
        description: 'Queue a sync of every connected Gmail account (funder mail only)',
    },
    async run() {
        if (!config.runBackgroundWorkers) {
            return { result: 'skipped (workers disabled on this instance)' }
        }
        if (!config.anthropicApiKey) {
            return { result: 'skipped (ANTHROPIC_API_KEY is not set)' }
        }
        const connections = await listActiveMailboxConnections()
        for (const connection of connections) {
            await enqueueMailboxSync({ mailboxConnectionId: connection.id })
        }
        return { result: `queued ${connections.length} mailbox syncs` }
    },
})
