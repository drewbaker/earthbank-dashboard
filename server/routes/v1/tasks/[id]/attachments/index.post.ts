import { getRouterParam, readMultipartFormData, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { createAttachmentRow } from '#server/database/attachments.ts'
import { findTask } from '#server/database/tasks.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { ApiError, badRequest, notFound } from '#server/utils/errors.ts'
import { newId } from '#server/utils/ids.ts'
import { serializeAttachment } from '#server/utils/serializers/tasks.ts'
import { putFile, safeFilename } from '#server/utils/storage.ts'

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Attach a file to a task',
        description: 'multipart/form-data with one `file` field, up to 25 MB.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: {
                'multipart/form-data': {
                    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
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
    const attachmentId = newId({ kind: 'attachment' })
    const filename = safeFilename({ filename: file.filename! })
    const storageKey = `tasks/${taskId}/${attachmentId}/${filename}`
    await putFile({ key: storageKey, data: file.data })
    const attachment = await createAttachmentRow({
        attachmentId,
        taskId,
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
        changes: { task_id: taskId, filename: attachment.filename },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializeAttachment({ attachment })
})
