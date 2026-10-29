import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findFunder } from '#server/database/funders.ts'
import { findOpportunity } from '#server/database/opportunities.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { storeAttachment } from '#server/utils/attachments/files.ts'
import { readUploadedFile } from '#server/utils/attachments/upload.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeAttachment } from '#server/utils/serializers/attachments.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Attachments'],
        summary: 'Attach a file to a funder',
        description:
            "multipart/form-data with one `file` field (up to 25 MB) and an optional `opportunity_id` for the ask it's about. PDFs and Word, Excel, PowerPoint and text files are then read by the AI, which updates the funder's asks the way an email does (confident changes apply, the rest wait on Activity); poll the list for `read_status`.",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: {
                'multipart/form-data': {
                    schema: {
                        type: 'object',
                        properties: { file: { type: 'string', format: 'binary' }, opportunity_id: { type: 'string' } },
                    },
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
    const funderId = getRouterParam(event, 'id') ?? ''
    const funder = await findFunder({ funderId })
    if (!funder) {
        throw notFound({ resource: 'Funder' })
    }
    const upload = await readUploadedFile({ event })
    const opportunity = upload.fields.opportunity_id
        ? await findOpportunity({ opportunityId: upload.fields.opportunity_id })
        : null
    if (upload.fields.opportunity_id && opportunity?.funder_id !== funderId) {
        throw notFound({ resource: 'Opportunity' })
    }
    const attachment = await storeAttachment({
        target: { kind: 'funder', funderId, opportunityId: opportunity?.id ?? null },
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
        changes: { funder_id: funderId, opportunity_id: opportunity?.id ?? null, filename: attachment.filename },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializeAttachment({ attachment })
})
