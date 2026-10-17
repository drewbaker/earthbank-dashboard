import { Job } from 'sidequest'
import { researchAiProvider } from '#server/utils/ai/provider.ts'
import { webResearcher } from '#server/utils/ai/web-research.ts'
import { researchFund } from '#server/utils/funds/research.ts'

/**
 * Researches one fund from public sources, cross-references public investment lists, and queues
 * research for new lenders it turns up (the spider). Safe to retry: a rerun only fills gaps, and
 * findings already stored are never duplicated.
 */
export class ResearchFundJob extends Job {
    /**
     * @param input.fundManagerId - The fund to research.
     * @returns The run's counts, or a skip note.
     */
    async run({ fundManagerId }: { fundManagerId: string }) {
        const researcher = webResearcher()
        if (!researcher) {
            return { skipped: 'ANTHROPIC_API_KEY is not set' }
        }
        return researchFund({ fundManagerId, researcher, classifier: researchAiProvider(), now: new Date() })
    }
}
