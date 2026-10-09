import { z } from 'zod'
import { TASK_STATUSES } from '#shared/constants/pipeline.ts'
import { DateOnly, DateOnlyInput, IsoDateTime, listOf, queryBoolean, UserSummary } from '#shared/schemas/common.ts'
import { OpportunityReference } from '#shared/schemas/milestones.ts'

export const Task = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(TASK_STATUSES),
    assignee: UserSummary.nullable(),
    due_at: DateOnly.nullable(),
    is_overdue: z.boolean(),
    milestone: z.object({ id: z.string(), title: z.string(), due_at: DateOnly }).nullable(),
    opportunity: OpportunityReference.nullable(),
    funder: z.object({ id: z.string(), name: z.string() }).nullable(),
    sort: z.number().int(),
    completed_at: IsoDateTime.nullable(),
    created_by: UserSummary.nullable(),
    comment_count: z.number().int(),
    attachment_count: z.number().int(),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
})
export type Task = z.infer<typeof Task>

export const TaskList = listOf(Task)
export type TaskList = z.infer<typeof TaskList>

export const Attachment = z.object({
    id: z.string(),
    task_id: z.string(),
    /** Set when the file belongs to a comment rather than the task. */
    comment_id: z.string().nullable(),
    filename: z.string(),
    content_type: z.string(),
    size_bytes: z.number().int(),
    uploaded_by: UserSummary.nullable(),
    download_url: z.string(),
    created_at: IsoDateTime,
})
export type Attachment = z.infer<typeof Attachment>

export const Comment = z.object({
    id: z.string(),
    task_id: z.string(),
    author: UserSummary.nullable(),
    body: z.string(),
    edited_at: IsoDateTime.nullable(),
    attachments: z.array(Attachment),
    created_at: IsoDateTime,
})
export type Comment = z.infer<typeof Comment>

export const TaskDetail = Task.extend({
    comments: z.array(Comment),
    /** Files attached to the task itself; comment files are on their comments. */
    attachments: z.array(Attachment),
})
export type TaskDetail = z.infer<typeof TaskDetail>

const TaskFields = {
    title: z.string().trim().min(1, 'Title is required.').max(300),
    description: z.string().trim().max(10000).nullable(),
    status: z.enum(TASK_STATUSES),
    assignee_id: z.string().nullable(),
    due_at: DateOnlyInput.nullable(),
    milestone_id: z.string().nullable(),
    opportunity_id: z.string().nullable(),
    funder_id: z.string().nullable(),
}

export const CreateTaskRequest = z.object({
    title: TaskFields.title,
    description: TaskFields.description.optional(),
    status: TaskFields.status.default('todo'),
    assignee_id: TaskFields.assignee_id.optional(),
    due_at: TaskFields.due_at.optional(),
    milestone_id: TaskFields.milestone_id.optional(),
    opportunity_id: TaskFields.opportunity_id.optional(),
    funder_id: TaskFields.funder_id.optional(),
})
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>

export const UpdateTaskRequest = z.object(TaskFields).partial()
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>

export const ReorderTasksRequest = z.object({ task_ids: z.array(z.string()).min(1).max(500) })
export type ReorderTasksRequest = z.infer<typeof ReorderTasksRequest>

export const ListTasksQuery = z.object({
    assignee_id: z.string().optional(),
    milestone_id: z.string().optional(),
    funder_id: z.string().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    include_done: queryBoolean(),
    due_before: DateOnly.optional(),
})

// A comment needs text, files, or both. The files are uploaded right after the comment is created
// (POST /v1/tasks/{id}/attachments with its comment_id); their names come along here for the email.
export const CreateCommentRequest = z
    .object({
        body: z.string().trim().max(10000).default(''),
        attachment_names: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    })
    .refine(comment => comment.body.length > 0 || comment.attachment_names.length > 0, {
        message: 'Write a comment or attach a file.',
        path: ['body'],
    })
export type CreateCommentRequest = z.infer<typeof CreateCommentRequest>

export const UpdateCommentRequest = z.object({ body: z.string().trim().min(1, 'Write a comment.').max(10000) })
export type UpdateCommentRequest = z.infer<typeof UpdateCommentRequest>
