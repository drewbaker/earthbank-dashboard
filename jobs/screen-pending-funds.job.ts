import { Job } from 'sidequest'
import { researchAiProvider } from '#server/utils/ai/provider.ts'
import { screenPendingFunds } from '#server/utils/funds/spider.ts'
import { webReader } from '#server/utils/web/firecrawl.ts'

/**
 * Screens pending funds the AI hasn't checked yet (found before the screen existed), archiving the
 * ones outside Earth Bank's focus. Safe to retry: each fund is screened once.
 */
export class ScreenPendingFundsJob extends Job {
    /**
     * @returns How many funds were screened and archived, or a skip note.
     */
    async run() {
        const classifier = researchAiProvider()
        if (!classifier) {
            return { skipped: 'ANTHROPIC_API_KEY is not set' }
        }
        return screenPendingFunds({ classifier, reader: webReader(), now: new Date() })
    }
}
