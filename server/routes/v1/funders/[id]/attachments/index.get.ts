import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { listOwnerAttachments } from '#server/database/attachments.ts'
import { findFunder } from '#server/database/funders.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeAttachment } from '#server/utils/serializers/attachments.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Attachments'],
        summary: "List a funder's files",
        description:
            "Files uploaded on the funder's page or emailed to the dashboard, newest first, with what the AI read from each.",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The files',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/AttachmentList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const funderId = getRouterParam(event, 'id') ?? ''
    if (!(await findFunder({ funderId }))) {
        throw notFound({ resource: 'Funder' })
    }
    const attachments = await listOwnerAttachments({ funderId })
    return { data: attachments.map(attachment => serializeAttachment({ attachment })) }
})
