import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'
import type { TaskStatus } from '#shared/constants/pipeline.ts'

export const TASK_INCLUDE = {
    assignee: true,
    created_by: true,
    milestone: true,
    opportunity: { include: { funder: true } },
    funder: true,
    _count: { select: { comments: { where: { deleted_at: null } }, attachments: { where: { deleted_at: null } } } },
} satisfies Prisma.TaskInclude

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>

/**
 * Create a task, placed last within its milestone.
 *
 * @param input.title - What to do.
 * @param input.description - Details.
 * @param input.status - Starting status.
 * @param input.assigneeId - Who does it.
 * @param input.dueAt - Deadline (calendar date).
 * @param input.milestoneId - Milestone it's for.
 * @param input.opportunityId - Opportunity it's about.
 * @param input.funderId - Funder it's about.
 * @param input.createdById - Who created it.
 * @returns The task with relations.
 */
export async function createTaskRow({
    title,
    description,
    status,
    assigneeId,
    dueAt,
    milestoneId,
    opportunityId,
    funderId,
    createdById,
}: {
    title: string
    description: string | null
    status: TaskStatus
    assigneeId: string | null
    dueAt: Date | null
    milestoneId: string | null
    opportunityId: string | null
    funderId: string | null
    createdById: string | null
}) {
    const last = await db().task.findFirst({
        where: { milestone_id: milestoneId, archived_at: null },
        orderBy: { sort: 'desc' },
        select: { sort: true },
    })
    return db().task.create({
        data: {
            id: newId({ kind: 'task' }),
            title,
            description,
            status,
            assignee_id: assigneeId,
            due_at: dueAt,
            milestone_id: milestoneId,
            opportunity_id: opportunityId,
            funder_id: funderId,
            created_by_id: createdById,
            sort: (last?.sort ?? 0) + 1,
            completed_at: status === 'done' ? new Date() : null,
        },
        include: TASK_INCLUDE,
    })
}

/**
 * Find a task (not archived) with relations.
 *
 * @param input.taskId - The task.
 * @returns The task, or null.
 */
export function findTask({ taskId }: { taskId: string }) {
    return db().task.findFirst({ where: { id: taskId, archived_at: null }, include: TASK_INCLUDE })
}

/**
 * List tasks: open ones first by deadline (undated last), then by milestone order.
 *
 * @param input.assigneeId - Only this person's tasks.
 * @param input.milestoneId - Only this milestone's tasks.
 * @param input.funderId - Only tasks about this funder (directly, or through their milestone).
 * @param input.status - Only this status.
 * @param input.includeDone - Include finished tasks.
 * @param input.dueBefore - Only tasks due before this date.
 * @returns Tasks with relations.
 */
export function listTaskRows({
    assigneeId,
    milestoneId,
    funderId,
    status,
    includeDone,
    dueBefore,
}: {
    assigneeId?: string
    milestoneId?: string
    funderId?: string
    status?: TaskStatus
    includeDone: boolean
    dueBefore?: Date
}) {
    return db().task.findMany({
        where: {
            archived_at: null,
            assignee_id: assigneeId,
            milestone_id: milestoneId,
            status: status ?? (includeDone ? undefined : { not: 'done' }),
            due_at: dueBefore ? { lt: dueBefore } : undefined,
            OR: funderId ? [{ funder_id: funderId }, { milestone: { funder_id: funderId } }] : undefined,
        },
        include: TASK_INCLUDE,
        orderBy: [{ due_at: { sort: 'asc', nulls: 'last' } }, { sort: 'asc' }, { id: 'asc' }],
    })
}

/**
 * Update task columns.
 *
 * @param input.taskId - The task.
 * @param input.data - Columns to set.
 * @returns The task with relations.
 */
export function updateTaskRow({ taskId, data }: { taskId: string; data: Prisma.TaskUncheckedUpdateInput }) {
    return db().task.update({ where: { id: taskId }, data, include: TASK_INCLUDE })
}

/**
 * Set the order of tasks (the first id gets the lowest sort value).
 *
 * @param input.taskIds - Task ids in their new order.
 * @returns Resolves once saved.
 */
export async function reorderTaskRows({ taskIds }: { taskIds: string[] }) {
    await db().$transaction(
        taskIds.map((taskId, index) => db().task.update({ where: { id: taskId }, data: { sort: index + 1 } })),
    )
}

/**
 * Open tasks due within a window, for the daily digest.
 *
 * @param input.dueBefore - Include tasks due before this date (overdue ones included).
 * @returns Tasks with relations, assigned to active users.
 */
export function listOpenTasksDueBefore({ dueBefore }: { dueBefore: Date }) {
    return db().task.findMany({
        where: {
            archived_at: null,
            status: { not: 'done' },
            due_at: { lt: dueBefore },
            assignee: { deactivated_at: null },
        },
        include: TASK_INCLUDE,
        orderBy: { due_at: 'asc' },
    })
}
