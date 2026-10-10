import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { createShareLinkRow } from '#server/database/share-links.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { encryptSecret, hashToken, newOpaqueToken } from '#server/utils/crypto.ts'
import { hashPassword } from '#server/utils/passwords.ts'
import { serializeShareLink } from '#server/utils/share-links.ts'
import { CreateShareLinkRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Sharing'],
        summary: 'Create a share link',
        description: 'A secret link plus a password; send both to funders (ideally the password separately).',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateShareLinkRequest' } } },
        },
        responses: {
            201: {
                description: 'Link created',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ShareLink' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: CreateShareLinkRequest })
    const token = newOpaqueToken()
    const link = await createShareLinkRow({
        label: body.label,
        tokenHash: hashToken({ token }),
        tokenEncrypted: encryptSecret({ plaintext: token }),
        passwordHash: await hashPassword({ password: body.password }),
        showNextSteps: body.show_next_steps,
        createdByUserId: ctx.user.id,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'share_link.created',
        entityType: 'share_link',
        entityId: link.id,
        changes: { label: body.label, show_next_steps: body.show_next_steps },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializeShareLink({ link })
})
