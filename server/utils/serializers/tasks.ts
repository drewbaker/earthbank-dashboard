import type {
    Attachment as AttachmentRow,
    Comment as CommentRow,
    User as UserRow,
} from '#server/generated/prisma/client.ts'
import type { TaskRow } from '#server/database/tasks.ts'
import { toDateOnly, toIsoDateTime } from '#server/utils/dates.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import type { TaskStatus } from '#shared/constants/pipeline.ts'
import type { Attachment, Comment, Task, TaskDetail } from '#shared/schemas/index.ts'

/**
 * Public shape of a task.
 *
 * @param input.task - The task with relations.
 * @param input.today - Today's date (YYYY-MM-DD), for "overdue".
 * @returns The API representation.
 */
export function serializeTask({ task, today }: { task: TaskRow; today: string }): Task {
    const dueAt = toDateOnly({ date: task.due_at })
    return {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status as TaskStatus,
        assignee: serializeUserSummary({ user: task.assignee }),
        due_at: dueAt,
        is_overdue: task.status !== 'done' && dueAt !== null && dueAt < today,
        milestone: task.milestone
            ? {
                  id: task.milestone.id,
                  title: task.milestone.title,
                  due_at: toDateOnly({ date: task.milestone.due_at })!,
              }
            : null,
        opportunity: task.opportunity
            ? {
                  id: task.opportunity.id,
                  name: task.opportunity.name,
                  funder: { id: task.opportunity.funder.id, name: task.opportunity.funder.name },
              }
            : null,
        funder: task.funder ? { id: task.funder.id, name: task.funder.name } : null,
        sort: task.sort,
        completed_at: toIsoDateTime({ date: task.completed_at }),
        created_by: serializeUserSummary({ user: task.created_by }),
        comment_count: task._count.comments,
        attachment_count: task._count.attachments,
        created_at: task.created_at.toISOString(),
        updated_at: task.updated_at.toISOString(),
    }
}

/**
 * Public shape of a comment.
 *
 * @param input.comment - The comment with its author.
 * @returns The API representation.
 */
export function serializeComment({ comment }: { comment: CommentRow & { author: UserRow | null } }): Comment {
    return {
        id: comment.id,
        task_id: comment.task_id,
        author: serializeUserSummary({ user: comment.author }),
        body: comment.body,
        edited_at: toIsoDateTime({ date: comment.edited_at }),
        created_at: comment.created_at.toISOString(),
    }
}

/**
 * Public shape of an attachment. The storage key stays internal; downloads go through the API.
 *
 * @param input.attachment - The attachment with its uploader.
 * @returns The API representation.
 */
export function serializeAttachment({
    attachment,
}: {
    attachment: AttachmentRow & { uploaded_by: UserRow | null }
}): Attachment {
    return {
        id: attachment.id,
        task_id: attachment.task_id,
        filename: attachment.filename,
        content_type: attachment.content_type,
        size_bytes: attachment.size_bytes,
        uploaded_by: serializeUserSummary({ user: attachment.uploaded_by }),
        download_url: `/v1/attachments/${attachment.id}/download`,
        created_at: attachment.created_at.toISOString(),
    }
}

/**
 * A task with its comments and attachments.
 *
 * @param input.task - The task with relations.
 * @param input.comments - Its comments.
 * @param input.attachments - Its attachments.
 * @param input.today - Today's date (YYYY-MM-DD).
 * @returns The API representation.
 */
export function serializeTaskDetail({
    task,
    comments,
    attachments,
    today,
}: {
    task: TaskRow
    comments: (CommentRow & { author: UserRow | null })[]
    attachments: (AttachmentRow & { uploaded_by: UserRow | null })[]
    today: string
}): TaskDetail {
    return {
        ...serializeTask({ task, today }),
        comments: comments.map(comment => serializeComment({ comment })),
        attachments: attachments.map(attachment => serializeAttachment({ attachment })),
    }
}
