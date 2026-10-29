import { Job } from 'sidequest'
import { aiProvider } from '#server/utils/ai/provider.ts'
import { readAttachment } from '#server/utils/attachments/read.ts'

/**
 * Has the AI read one funder or fund file (usually a PDF) into the pipeline or the fund's research.
 * Safe to retry: each run records what it read, and a file that was read or removed is skipped.
 */
export class ReadAttachmentJob extends Job {
    /**
     * @param input.attachmentId - The file.
     * @returns What was read, or a skip note.
     */
    async run({ attachmentId }: { attachmentId: string }) {
        const ai = aiProvider()
        if (!ai) {
            return { skipped: 'ANTHROPIC_API_KEY is not set' }
        }
        return readAttachment({ attachmentId, ai, now: new Date() })
    }
}
