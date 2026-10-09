import { goalIdsByType } from '#server/database/goals.ts'
import { findOpportunity } from '#server/database/opportunities.ts'
import { badRequest } from '#server/utils/errors.ts'
import type { GoalType } from '#shared/constants/pipeline.ts'

/**
 * Turn a milestone's goal type and opportunity into ids, filling in the funder (and the goal, when
 * only an opportunity is given).
 *
 * @param input.goalType - Goal, if any.
 * @param input.opportunityId - Opportunity, if any.
 * @returns `{ goalId, opportunityId, funderId }`.
 * @throws ApiError 400 when the opportunity doesn't exist.
 */
export async function resolveMilestoneLinks({
    goalType,
    opportunityId,
}: {
    goalType: GoalType | null
    opportunityId: string | null
}) {
    let goalId = goalType ? ((await goalIdsByType()).get(goalType) ?? null) : null
    let funderId: string | null = null
    if (opportunityId) {
        const opportunity = await findOpportunity({ opportunityId })
        if (!opportunity) {
            throw badRequest({ message: 'That opportunity no longer exists.', code: 'invalid_opportunity' })
        }
        funderId = opportunity.funder_id
        goalId ??= opportunity.goal_id
    }
    return { goalId, opportunityId, funderId }
}
