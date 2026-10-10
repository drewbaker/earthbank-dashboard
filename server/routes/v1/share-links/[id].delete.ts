import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findActiveShareLink, revokeShareLinkRow } from '#server/database/share-links.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Sharing'],
        summary: 'Turn off a share link',
        description: 'The link stops working at once, for everyone who has it.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Turned off' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const shareLinkId = getRouterParam(event, 'id') ?? ''
    const link = await findActiveShareLink({ shareLinkId })
    if (!link) {
        throw notFound({ resource: 'Share link' })
    }
    await revokeShareLinkRow({ shareLinkId, revokedAt: new Date() })
    await recordAudit({
        actor: ctx.actor,
        action: 'share_link.revoked',
        entityType: 'share_link',
        entityId: shareLinkId,
        changes: { label: link.label },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
