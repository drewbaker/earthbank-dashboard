import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findAttachment, updateAttachmentRead } from '#server/database/attachments.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { isReadableType } from '#server/utils/attachments/files.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { badRequest, notFound } from '#server/utils/errors.ts'
import { enqueueAttachmentRead } from '#server/utils/jobs/enqueue.ts'
import { serializeAttachment } from '#server/utils/serializers/attachments.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Attachments'],
        summary: 'Read a file again',
        description:
            "Queues the AI reading of a funder or fund file again (after it failed, or when the file's funder or fund has changed). Facts already recorded aren't duplicated.",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The file, queued for reading',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Attachment' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const attachmentId = getRouterParam(event, 'id') ?? ''
    const attachment = await findAttachment({ attachmentId })
    if (!attachment) {
        throw notFound({ resource: 'Attachment' })
    }
    if (!attachment.funder_id && !attachment.fund_manager_id) {
        throw badRequest({ message: 'Only funder and fund files are read by the AI.', code: 'not_read_by_ai' })
    }
    if (!isReadableType({ type: attachment.content_type })) {
        throw badRequest({
            message: 'The AI reads PDFs and Word, Excel, PowerPoint and text files only.',
            code: 'unreadable_file',
        })
    }
    const queued = await updateAttachmentRead({
        attachmentId,
        data: { read_status: 'queued', read_error: null },
    })
    await enqueueAttachmentRead({ attachmentId })
    await recordAudit({
        actor: ctx.actor,
        action: 'attachment.read_requested',
        entityType: 'attachment',
        entityId: attachmentId,
        ip: requestIp({ event }),
    })
    return serializeAttachment({ attachment: queued })
})
