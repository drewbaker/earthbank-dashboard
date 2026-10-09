import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'
import type { GoalType, MilestoneKind, MilestoneStatus } from '#shared/constants/pipeline.ts'

export const MILESTONE_INCLUDE = {
    goal: true,
    opportunity: { include: { funder: true } },
    funder: true,
    tasks: { where: { archived_at: null }, select: { status: true } },
} satisfies Prisma.MilestoneInclude

export type MilestoneRow = Prisma.MilestoneGetPayload<{ include: typeof MILESTONE_INCLUDE }>

/**
 * Create a milestone.
 *
 * @param input.title - What happens.
 * @param input.description - Details.
 * @param input.dueAt - When (calendar date at UTC midnight).
 * @param input.kind - Funding, event or internal.
 * @param input.goalId - Goal it counts toward, if any.
 * @param input.opportunityId - Opportunity it belongs to, if any.
 * @param input.funderId - Funder (taken from the opportunity by the caller).
 * @param input.createdById - Who created it.
 * @returns The milestone with relations.
 */
export function createMilestoneRow({
    title,
    description,
    dueAt,
    kind,
    goalId,
    opportunityId,
    funderId,
    createdById,
}: {
    title: string
    description: string | null
    dueAt: Date
    kind: MilestoneKind
    goalId: string | null
    opportunityId: string | null
    funderId: string | null
    createdById: string | null
}) {
    return db().milestone.create({
        data: {
            id: newId({ kind: 'milestone' }),
            title,
            description,
            due_at: dueAt,
            kind,
            goal_id: goalId,
            opportunity_id: opportunityId,
            funder_id: funderId,
            created_by_id: createdById,
        },
        include: MILESTONE_INCLUDE,
    })
}

/**
 * Find a milestone (not archived) with relations.
 *
 * @param input.milestoneId - The milestone.
 * @returns The milestone, or null.
 */
export function findMilestone({ milestoneId }: { milestoneId: string }) {
    return db().milestone.findFirst({ where: { id: milestoneId, archived_at: null }, include: MILESTONE_INCLUDE })
}

/**
 * List milestones by due date.
 *
 * @param input.includeDone - Include completed milestones.
 * @param input.funderId - Only this funder's milestones.
 * @param input.goalType - Only milestones for this goal.
 * @param input.dueBefore - Only milestones due before this date.
 * @param input.dueAfter - Only milestones due on or after this date.
 * @returns Milestones with relations.
 */
export function listMilestoneRows({
    includeDone,
    funderId,
    goalType,
    dueBefore,
    dueAfter,
}: {
    includeDone: boolean
    funderId?: string
    goalType?: GoalType
    dueBefore?: Date
    dueAfter?: Date
}) {
    return db().milestone.findMany({
        where: {
            archived_at: null,
            status: includeDone ? undefined : 'open',
            funder_id: funderId,
            goal: goalType ? { type: goalType } : undefined,
            due_at: dueBefore || dueAfter ? { lt: dueBefore, gte: dueAfter } : undefined,
        },
        include: MILESTONE_INCLUDE,
        orderBy: [{ due_at: 'asc' }, { id: 'asc' }],
    })
}

/**
 * Update milestone columns.
 *
 * @param input.milestoneId - The milestone.
 * @param input.data - Columns to set.
 * @returns The milestone with relations.
 */
export function updateMilestoneRow({
    milestoneId,
    data,
}: {
    milestoneId: string
    data: Prisma.MilestoneUncheckedUpdateInput
}) {
    return db().milestone.update({ where: { id: milestoneId }, data, include: MILESTONE_INCLUDE })
}

/**
 * Archive a milestone and detach its tasks (they stay, without a milestone).
 *
 * @param input.milestoneId - The milestone.
 * @param input.archivedAt - When.
 * @returns Resolves once done.
 */
export async function archiveMilestone({ milestoneId, archivedAt }: { milestoneId: string; archivedAt: Date }) {
    await db().$transaction([
        db().task.updateMany({ where: { milestone_id: milestoneId }, data: { milestone_id: null } }),
        db().milestone.update({ where: { id: milestoneId }, data: { archived_at: archivedAt } }),
    ])
}
