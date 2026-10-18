import { Job } from 'sidequest'
import { researchAiProvider } from '#server/utils/ai/provider.ts'
import { syncPublicInvestmentSource } from '#server/utils/funds/public-investments.ts'
import { webReader } from '#server/utils/web/firecrawl.ts'

/**
 * Reads one DFI or government list of investments and grants, stores its rows, matches them to funds
 * and queues research for lenders on it that aren't on the list yet. Safe to retry: rows are keyed
 * by the institution's own ids.
 */
export class SyncPublicInvestmentsJob extends Job {
    /**
     * @param input.sourceKey - The list's key (PUBLIC_INVESTMENT_SOURCES).
     * @returns Counts, or a skip note.
     */
    async run({ sourceKey }: { sourceKey: string }) {
        const ai = researchAiProvider()
        if (!ai) {
            return { skipped: 'ANTHROPIC_API_KEY is not set' }
        }
        return syncPublicInvestmentSource({ sourceKey, ai, reader: webReader(), now: new Date() })
    }
}
