import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { storeAttachment } from '#server/utils/attachments/files.ts'
import { readUploadedFile } from '#server/utils/attachments/upload.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { badRequest } from '#server/utils/errors.ts'
import { requireFund } from '#server/utils/funds/fund-detail.ts'
import { serializeAttachment } from '#server/utils/serializers/attachments.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Attachments'],
        summary: 'Attach a file to a fund',
        description:
            "multipart/form-data with one `file` field (up to 25 MB). PDFs and Word, Excel, PowerPoint and text files are then read by the AI into the fund's research and due diligence, every fact quoted from the file and credited to it (a person's diligence answer is never replaced); poll the list for `read_status`.",
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
                description: 'File attached (and queued for reading)',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Attachment' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const fundManagerId = getRouterParam(event, 'id') ?? ''
    const fund = await requireFund({ fundManagerId })
    if (fund.archived_at) {
        throw badRequest({ message: 'Restore the fund before adding files to it.', code: 'fund_archived' })
    }
    const upload = await readUploadedFile({ event })
    const attachment = await storeAttachment({
        target: { kind: 'fund', fundManagerId },
        data: upload.data,
        filename: upload.filename,
        contentType: upload.contentType,
        uploadedById: ctx.user.id,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'attachment.created',
        entityType: 'attachment',
        entityId: attachment.id,
        changes: { fund_id: fundManagerId, filename: attachment.filename },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializeAttachment({ attachment })
})
