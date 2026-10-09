import { Job } from 'sidequest'
import { syncKnowledgeSource } from '#server/utils/knowledge/sync.ts'

/**
 * Brings one Drive knowledge folder up to date. Safe to retry: unchanged files are skipped.
 */
export class SyncKnowledgeJob extends Job {
    /**
     * @param input.knowledgeSourceId - The source.
     * @returns Counts, or a skip note.
     */
    async run({ knowledgeSourceId }: { knowledgeSourceId: string }) {
        return syncKnowledgeSource({ knowledgeSourceId, now: new Date() })
    }
}
