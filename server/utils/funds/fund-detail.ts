import { findFundManager } from '#server/database/fund-managers.ts'
import {
    listFundDiligenceAnswers,
    listFundFindings,
    listFundPeople,
    listFundResearchRuns,
} from '#server/database/fund-research.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeFundDetail } from '#server/utils/serializers/funds.ts'

/**
 * Load and serialize a fund's full profile.
 *
 * @param input.fundManagerId - The fund.
 * @returns The fund detail.
 * @throws ApiError 404 when the fund doesn't exist.
 */
export async function loadFundDetail({ fundManagerId }: { fundManagerId: string }) {
    const fund = await findFundManager({ fundManagerId })
    if (!fund) {
        throw notFound({ resource: 'Fund' })
    }
    const [findings, people, answers, runs] = await Promise.all([
        listFundFindings({ fundManagerId }),
        listFundPeople({ fundManagerId }),
        listFundDiligenceAnswers({ fundManagerId }),
        listFundResearchRuns({ fundManagerId, limit: 10 }),
    ])
    return serializeFundDetail({ fund, findings, people, answers, runs })
}

/**
 * Load a fund or fail with 404.
 *
 * @param input.fundManagerId - The fund.
 * @returns The fund row.
 * @throws ApiError 404 when it doesn't exist.
 */
export async function requireFund({ fundManagerId }: { fundManagerId: string }) {
    const fund = await findFundManager({ fundManagerId })
    if (!fund) {
        throw notFound({ resource: 'Fund' })
    }
    return fund
}
