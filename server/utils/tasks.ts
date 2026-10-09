import { listTaskAttachments } from '#server/database/attachments.ts'
import { listTaskComments } from '#server/database/comments.ts'
import { findFunder } from '#server/database/funders.ts'
import { findMilestone } from '#server/database/milestones.ts'
import { findOpportunity } from '#server/database/opportunities.ts'
import { findTask } from '#server/database/tasks.ts'
import { todayDateOnly } from '#server/utils/dates.ts'
import { badRequest, notFound } from '#server/utils/errors.ts'
import { serializeTaskDetail } from '#server/utils/serializers/tasks.ts'

/**
 * Check a task's links and fill in the funder: an opportunity implies its funder, and a milestone
 * implies its opportunity's funder.
 *
 * @param input.milestoneId - Milestone, if any.
 * @param input.opportunityId - Opportunity, if any.
 * @param input.funderId - Funder, if given directly.
 * @returns The validated ids with the funder filled in.
 * @throws ApiError 400 when a linked record doesn't exist.
 */
export async function resolveTaskLinks({
    milestoneId,
    opportunityId,
    funderId,
}: {
    milestoneId: string | null
    opportunityId: string | null
    funderId: string | null
}) {
    let resolvedFunderId = funderId
    if (milestoneId) {
        const milestone = await findMilestone({ milestoneId })
        if (!milestone) {
            throw badRequest({ message: 'That milestone no longer exists.', code: 'invalid_milestone' })
        }
        resolvedFunderId ??= milestone.funder_id
    }
    if (opportunityId) {
        const opportunity = await findOpportunity({ opportunityId })
        if (!opportunity) {
            throw badRequest({ message: 'That opportunity no longer exists.', code: 'invalid_opportunity' })
        }
        resolvedFunderId = opportunity.funder_id
    }
    if (resolvedFunderId && !(await findFunder({ funderId: resolvedFunderId }))) {
        throw badRequest({ message: 'That funder no longer exists.', code: 'invalid_funder' })
    }
    return { milestoneId, opportunityId, funderId: resolvedFunderId }
}

/**
 * Load a task with its comments and attachments.
 *
 * @param input.taskId - The task.
 * @returns The serialized task detail.
 * @throws ApiError 404 when the task doesn't exist.
 */
export async function loadTaskDetail({ taskId }: { taskId: string }) {
    const task = await findTask({ taskId })
    if (!task) {
        throw notFound({ resource: 'Task' })
    }
    const [comments, attachments] = await Promise.all([listTaskComments({ taskId }), listTaskAttachments({ taskId })])
    return serializeTaskDetail({ task, comments, attachments, today: todayDateOnly() })
}
