import { getRouterParam, readMultipartFormData, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { createAttachmentRow } from '#server/database/attachments.ts'
import { findComment } from '#server/database/comments.ts'
import { findTask } from '#server/database/tasks.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { ApiError, badRequest, forbidden, notFound } from '#server/utils/errors.ts'
import { newId } from '#server/utils/ids.ts'
import { serializeAttachment } from '#server/utils/serializers/tasks.ts'
import { putFile, safeFilename } from '#server/utils/storage.ts'

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Attach a file to a task',
        description:
            'multipart/form-data with one `file` field, up to 25 MB, and an optional `comment_id` to attach it to one of your comments on this task.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: {
                'multipart/form-data': {
                    schema: {
                        type: 'object',
                        properties: { file: { type: 'string', format: 'binary' }, comment_id: { type: 'string' } },
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'File attached',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Attachment' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const taskId = getRouterParam(event, 'id') ?? ''
    if (!(await findTask({ taskId }))) {
        throw notFound({ resource: 'Task' })
    }
    const parts = (await readMultipartFormData(event)) ?? []
    const file = parts.find(part => part.name === 'file' && part.filename)
    if (!file) {
        throw badRequest({ message: 'Choose a file to upload.', code: 'missing_file' })
    }
    if (file.data.length > MAX_ATTACHMENT_BYTES) {
        throw new ApiError({ status: 413, code: 'file_too_large', message: 'Files can be up to 25 MB.' })
    }
    const commentId = await commentToAttachTo({
        commentId: parts.find(part => part.name === 'comment_id')?.data.toString('utf8') || null,
        taskId,
        userId: ctx.user.id,
    })
    const attachmentId = newId({ kind: 'attachment' })
    const filename = safeFilename({ filename: file.filename! })
    const storageKey = `tasks/${taskId}/${attachmentId}/${filename}`
    await putFile({ key: storageKey, data: file.data })
    const attachment = await createAttachmentRow({
        attachmentId,
        taskId,
        commentId,
        uploadedById: ctx.user.id,
        filename: file.filename!.split(/[/\\]/).at(-1)!.slice(0, 200),
        contentType: file.type ?? 'application/octet-stream',
        sizeBytes: file.data.length,
        storageKey,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'attachment.created',
        entityType: 'attachment',
        entityId: attachmentId,
        changes: { task_id: taskId, comment_id: commentId, filename: attachment.filename },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializeAttachment({ attachment })
})

/**
 * Check a comment the file is meant for: it must be one of the uploader's own live comments on this task.
 *
 * @param input.commentId - The `comment_id` form field, if sent.
 * @param input.taskId - The task in the URL.
 * @param input.userId - The uploader.
 * @returns The comment id, or null to attach the file to the task.
 * @throws ApiError 404 when the comment isn't on this task, 403 when it's someone else's.
 */
async function commentToAttachTo({
    commentId,
    taskId,
    userId,
}: {
    commentId: string | null
    taskId: string
    userId: string
}) {
    if (!commentId) {
        return null
    }
    const comment = await findComment({ commentId })
    if (!comment || comment.task_id !== taskId) {
        throw notFound({ resource: 'Comment' })
    }
    if (comment.author_id !== userId) {
        throw forbidden({ message: 'You can only attach files to your own comments.', code: 'not_comment_author' })
    }
    return comment.id
}
