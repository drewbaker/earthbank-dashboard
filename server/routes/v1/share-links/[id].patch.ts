import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findActiveShareLink, updateShareLinkRow } from '#server/database/share-links.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeShareLink } from '#server/utils/share-links.ts'
import { UpdateShareLinkRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Sharing'],
        summary: 'Change a share link',
        description: 'Its name, whether next steps show, and which parts of the page it shows.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateShareLinkRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated link',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ShareLink' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const shareLinkId = getRouterParam(event, 'id') ?? ''
    if (!(await findActiveShareLink({ shareLinkId }))) {
        throw notFound({ resource: 'Share link' })
    }
    const body = await parseBody({ event, schema: UpdateShareLinkRequest })
    const link = await updateShareLinkRow({ shareLinkId, data: body })
    await recordAudit({
        actor: ctx.actor,
        action: 'share_link.updated',
        entityType: 'share_link',
        entityId: shareLinkId,
        changes: body,
        ip: requestIp({ event }),
    })
    return serializeShareLink({ link })
})
