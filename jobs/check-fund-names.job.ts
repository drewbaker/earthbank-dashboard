import { Job } from 'sidequest'
import { researchAiProvider } from '#server/utils/ai/provider.ts'
import { checkFundNames } from '#server/utils/funds/fund-names.ts'

/**
 * Tidies the names of funds added before names were checked (all capitals, legal forms at the end).
 * Safe to retry: each fund is checked once, and its name key never changes.
 */
export class CheckFundNamesJob extends Job {
    /**
     * @returns How many names were checked and changed.
     */
    async run() {
        return checkFundNames({ classifier: researchAiProvider(), now: new Date() })
    }
}
