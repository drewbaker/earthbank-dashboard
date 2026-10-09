import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { createCommentRow } from '#server/database/comments.ts'
import { findTask } from '#server/database/tasks.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { notifyTaskCommented } from '#server/utils/notifications.ts'
import { serializeComment } from '#server/utils/serializers/tasks.ts'
import { CreateCommentRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Comment on a task',
        description: "Emails the task's assignee and earlier commenters (never the author).",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateCommentRequest' } } },
        },
        responses: {
            201: {
                description: 'Comment added',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Comment' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const taskId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: CreateCommentRequest })
    const task = await findTask({ taskId })
    if (!task) {
        throw notFound({ resource: 'Task' })
    }
    const comment = await createCommentRow({ taskId, authorId: ctx.user.id, body: body.body })
    await notifyTaskCommented({ task, authorId: ctx.user.id, body: body.body })
    await recordAudit({
        actor: ctx.actor,
        action: 'comment.created',
        entityType: 'comment',
        entityId: comment.id,
        changes: { task_id: taskId },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializeComment({ comment })
})
