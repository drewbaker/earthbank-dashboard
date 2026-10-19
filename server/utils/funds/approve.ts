import { approveFundManager, findFundManager } from '#server/database/fund-managers.ts'
import { queueFundRefresh } from '#server/utils/funds/refresh.ts'

/**
 * Approve a fund the spider found, so it joins the list, board and map, and queue its research if it
 * hasn't been researched yet (a person chose it, so it goes ahead of the spider).
 *
 * @param input.fundManagerId - The fund.
 * @param input.approvedById - The team member approving it.
 * @param input.now - Current time.
 * @returns Whether this call approved it (false when it was already approved).
 */
export async function approveFund({
    fundManagerId,
    approvedById,
    now,
}: {
    fundManagerId: string
    approvedById: string
    now: Date
}) {
    const isApproved = await approveFundManager({ fundManagerId, approvedById, now })
    const fund = await findFundManager({ fundManagerId })
    if (isApproved && fund?.research_status === 'awaiting_approval') {
        await queueFundRefresh({ fundManagerId, now })
    }
    return isApproved
}
