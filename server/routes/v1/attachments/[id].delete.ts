import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findAttachment, markAttachmentDeleted } from '#server/database/attachments.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Remove an attachment',
        description: 'The file is deleted from disk by the hourly cleanup after 30 days.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Removed' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const attachmentId = getRouterParam(event, 'id') ?? ''
    const attachment = await findAttachment({ attachmentId })
    if (!attachment) {
        throw notFound({ resource: 'Attachment' })
    }
    await markAttachmentDeleted({ attachmentId, deletedAt: new Date() })
    await recordAudit({
        actor: ctx.actor,
        action: 'attachment.deleted',
        entityType: 'attachment',
        entityId: attachmentId,
        changes: { task_id: attachment.task_id, filename: attachment.filename },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
