import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { regenerateForwardingAddress } from '#server/utils/mail/inbound.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Email'],
        summary: 'New forwarding address',
        description: 'Replaces your private forwarding address; the old one stops working.',
        responses: { 200: { description: 'The new address' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const forwardingAddress = await regenerateForwardingAddress({ userId: ctx.user.id })
    await recordAudit({
        actor: ctx.actor,
        action: 'forwarding_address.regenerated',
        entityType: 'user',
        entityId: ctx.user.id,
        ip: requestIp({ event }),
    })
    return { forwarding_address: forwardingAddress }
})
