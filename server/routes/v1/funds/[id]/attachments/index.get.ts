import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { listOwnerAttachments } from '#server/database/attachments.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { requireFund } from '#server/utils/funds/fund-detail.ts'
import { serializeAttachment } from '#server/utils/serializers/attachments.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Attachments'],
        summary: "List a fund's files",
        description:
            "Files uploaded on the fund's Files tab or emailed to the dashboard, newest first, with what the AI read from each.",
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
    const fundManagerId = getRouterParam(event, 'id') ?? ''
    await requireFund({ fundManagerId })
    const attachments = await listOwnerAttachments({ fundManagerId })
    return { data: attachments.map(attachment => serializeAttachment({ attachment })) }
})
