import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findUserByEmail } from '#server/database/users.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { safeRedirectPath } from '#server/utils/auth/google.ts'
import { badRequest, tooManyRequests } from '#server/utils/errors.ts'
import { isSignInLinkRequestLimited, isWorkspaceEmail, sendSignInLinkEmail } from '#server/utils/sign-in-links.ts'
import { RequestSignInLinkRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Auth'],
        summary: 'Email a guest a sign-in link (public)',
        description:
            "For invited guests outside the Earth Bank Workspace. Always answers 204 for addresses on other domains, whether or not they've been invited, so it can't be used to find out who has access.",
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RequestSignInLinkRequest' } } },
        },
        responses: {
            204: { description: 'If the address belongs to an invited guest, a link is on its way' },
            400: { description: 'An Earth Bank address: sign in with Google instead' },
            429: { description: 'Too many requests; try again later' },
        },
    },
})

export default defineApiHandler(async event => {
    const { email, redirect } = await parseBody({ event, schema: RequestSignInLinkRequest })
    if (isWorkspaceEmail({ email })) {
        throw badRequest({ message: 'Earth Bank staff sign in with Google.', code: 'use_google_sign_in' })
    }
    if (isSignInLinkRequestLimited({ email, ip: requestIp({ event }) })) {
        throw tooManyRequests({ message: 'Too many sign-in links asked for. Try again in 15 minutes.' })
    }
    const user = await findUserByEmail({ email })
    // Guests only: a Workspace account never gets a link, and a deactivated one is silently ignored.
    if (user && !user.google_sub && !user.deactivated_at) {
        await sendSignInLinkEmail({ userId: user.id, email, redirectPath: safeRedirectPath({ redirect }) })
    } else {
        console.info('[auth] sign-in link asked for an address without guest access')
    }
    setResponseStatus(event, 204)
    return null
})
