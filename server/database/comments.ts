import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

export const COMMENT_INCLUDE = { author: true } as const

/**
 * Add a comment to a task.
 *
 * @param input.taskId - The task.
 * @param input.authorId - Who wrote it.
 * @param input.body - The text.
 * @returns The comment with its author.
 */
export function createCommentRow({ taskId, authorId, body }: { taskId: string; authorId: string; body: string }) {
    return db().comment.create({
        data: { id: newId({ kind: 'comment' }), task_id: taskId, author_id: authorId, body },
        include: COMMENT_INCLUDE,
    })
}

/**
 * Find a live comment.
 *
 * @param input.commentId - The comment.
 * @returns The comment with its author, or null.
 */
export function findComment({ commentId }: { commentId: string }) {
    return db().comment.findFirst({ where: { id: commentId, deleted_at: null }, include: COMMENT_INCLUDE })
}

/**
 * A task's live comments, oldest first.
 *
 * @param input.taskId - The task.
 * @returns Comments with authors.
 */
export function listTaskComments({ taskId }: { taskId: string }) {
    return db().comment.findMany({
        where: { task_id: taskId, deleted_at: null },
        include: COMMENT_INCLUDE,
        orderBy: { id: 'asc' },
    })
}

/**
 * Distinct people who have commented on a task.
 *
 * @param input.taskId - The task.
 * @returns Author user ids.
 */
export async function listTaskCommenterIds({ taskId }: { taskId: string }) {
    const rows = await db().comment.findMany({
        where: { task_id: taskId, deleted_at: null, author_id: { not: null } },
        select: { author_id: true },
        distinct: ['author_id'],
    })
    return rows.map(row => row.author_id!)
}

/**
 * Edit or delete a comment.
 *
 * @param input.commentId - The comment.
 * @param input.body - New text, undefined to keep.
 * @param input.editedAt - When edited.
 * @param input.deletedAt - When deleted, undefined to keep.
 * @returns The comment with its author.
 */
export function updateCommentRow({
    commentId,
    body,
    editedAt,
    deletedAt,
}: {
    commentId: string
    body?: string
    editedAt?: Date
    deletedAt?: Date
}) {
    return db().comment.update({
        where: { id: commentId },
        data: { body, edited_at: editedAt, deleted_at: deletedAt },
        include: COMMENT_INCLUDE,
    })
}
