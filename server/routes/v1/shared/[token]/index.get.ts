import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findActiveShareLinkByTokenHash, recordShareLinkView } from '#server/database/share-links.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { hashToken } from '#server/utils/crypto.ts'
import { notFound, unauthorized } from '#server/utils/errors.ts'
import { buildSharedPipeline, isShareLinkUnlocked } from '#server/utils/share-links.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Sharing'],
        summary: 'Shared pipeline (public)',
        description:
            'No sign-in: needs the secret link and, once per browser every 12 hours, its password (POST …/unlock). Shows funder names, contact names, geographic focus, amounts, stages and short next steps only.',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The shared pipeline',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/SharedPipeline' } } },
            },
            401: { description: 'Password needed' },
        },
    },
})

export default defineApiHandler(async event => {
    const link = await findActiveShareLinkByTokenHash({
        tokenHash: hashToken({ token: getRouterParam(event, 'token') ?? '' }),
    })
    if (!link) {
        throw notFound({ resource: 'Link' })
    }
    if (!isShareLinkUnlocked({ event, shareLinkId: link.id })) {
        throw unauthorized({ message: 'Enter the password to view this page.' })
    }
    await recordShareLinkView({ shareLinkId: link.id, viewedAt: new Date() })
    return buildSharedPipeline({ showNextSteps: link.show_next_steps })
})
