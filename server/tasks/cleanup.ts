import { defineTask } from 'nitropack/runtime'
import { deleteAttachmentRows, listPurgeableAttachments } from '#server/database/attachments.ts'
import { deleteExpiredSessions } from '#server/database/sessions.ts'
import { supersedeAllStaleSuggestions } from '#server/utils/change-events.ts'
import { config } from '#server/utils/config.ts'
import { deleteStoredFile } from '#server/utils/storage.ts'

// Removed attachments stay restorable from the database for a while before their files go.
const ATTACHMENT_RETENTION_DAYS = 30

export default defineTask({
    meta: {
        name: 'cleanup',
        description:
            'Delete expired sessions and the files of attachments removed over 30 days ago; retire out-of-date suggestions',
    },
    async run() {
        if (!config.runBackgroundWorkers) {
            return { result: 'skipped (workers disabled on this instance)' }
        }
        const now = new Date()
        const deletedSessions = await deleteExpiredSessions({ now })
        const purgeable = await listPurgeableAttachments({
            deletedBefore: new Date(now.getTime() - ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        })
        for (const attachment of purgeable) {
            await deleteStoredFile({ key: attachment.storage_key })
        }
        const purgedAttachments = await deleteAttachmentRows({
            attachmentIds: purgeable.map(attachment => attachment.id),
        })
        const supersededSuggestions = await supersedeAllStaleSuggestions()
        return {
            result: `deleted ${deletedSessions} expired sessions, purged ${purgedAttachments} attachments, retired ${supersededSuggestions} out-of-date suggestions`,
        }
    },
})
