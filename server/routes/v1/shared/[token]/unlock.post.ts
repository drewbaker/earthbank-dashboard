import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findActiveShareLinkByTokenHash } from '#server/database/share-links.ts'
import { defineApiHandler, parseBody } from '#server/utils/api.ts'
import { hashToken } from '#server/utils/crypto.ts'
import { badRequest, notFound, tooManyRequests } from '#server/utils/errors.ts'
import { verifyPassword } from '#server/utils/passwords.ts'
import {
    isShareLinkPaused,
    recordFailedShareLinkAttempt,
    rememberUnlockedShareLink,
} from '#server/utils/share-links.ts'
import { UnlockShareLinkRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Sharing'],
        summary: 'Unlock a shared pipeline (public)',
        description: 'Checks the password and remembers it in this browser for 12 hours.',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UnlockShareLinkRequest' } } },
        },
        responses: {
            204: { description: 'Unlocked' },
            400: { description: 'Wrong password' },
            429: { description: 'Too many wrong passwords; try again later' },
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
    if (isShareLinkPaused({ shareLinkId: link.id })) {
        throw tooManyRequests({ message: 'Too many wrong passwords. Try again in 15 minutes.' })
    }
    const { password } = await parseBody({ event, schema: UnlockShareLinkRequest })
    if (link.password_hash && !(await verifyPassword({ password, passwordHash: link.password_hash }))) {
        recordFailedShareLinkAttempt({ shareLinkId: link.id })
        throw badRequest({ message: "That password isn't right.", code: 'wrong_password' })
    }
    rememberUnlockedShareLink({ event, shareLinkId: link.id })
    setResponseStatus(event, 204)
    return null
})
