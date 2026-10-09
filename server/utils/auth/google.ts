import type { H3Event } from 'h3'
import { deleteCookie, getCookie, setCookie } from 'h3'
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { config } from '#server/utils/config.ts'
import { decryptSecret, encryptSecret, newOpaqueToken, secretsMatch } from '#server/utils/crypto.ts'

const OAUTH_STATE_COOKIE_NAME = 'earthbank_dashboard_oauth'
const OAUTH_STATE_TTL_SECONDS = 10 * 60
const SIGN_IN_SCOPES = ['openid', 'email', 'profile']

const OAuthState = z.object({
    state: z.string(),
    codeVerifier: z.string(),
    redirectPath: z.string(),
})

export type WorkspaceIdentityRejection =
    'missing_claims' | 'email_not_verified' | 'wrong_workspace' | 'wrong_email_domain'

export type WorkspaceIdentity = { googleSub: string; email: string; name: string; avatarUrl: string | null }

/**
 * The OAuth client used for both sign-in and (later) Gmail access.
 *
 * @returns A configured `OAuth2Client`.
 * @throws Error when the Google client id or secret isn't configured.
 */
function googleOAuthClient() {
    if (!config.googleClientId || !config.googleClientSecret) {
        throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to sign in with Google')
    }
    return new OAuth2Client({
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        redirectUri: `${config.appUrl}/auth/google/callback`,
    })
}

/**
 * Keep post-sign-in redirects on this site: only paths like `/pipeline`, never `//evil.com` or URLs.
 *
 * @param input.redirect - The requested redirect, usually from the query string.
 * @returns A same-site path, defaulting to `/`.
 */
export function safeRedirectPath({ redirect }: { redirect: unknown }) {
    return typeof redirect === 'string' && /^\/(?![/\\])/.test(redirect) ? redirect : '/'
}

/**
 * Build the Google sign-in URL and store the state + PKCE verifier in an encrypted, short-lived cookie.
 *
 * @param input.event - The request; receives the state cookie.
 * @param input.redirectPath - Same-site path to return to after sign-in.
 * @returns The Google authorization URL to redirect to.
 */
export async function beginGoogleSignIn({ event, redirectPath }: { event: H3Event; redirectPath: string }) {
    const client = googleOAuthClient()
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
    const state = newOpaqueToken()
    setCookie(
        event,
        OAUTH_STATE_COOKIE_NAME,
        encryptSecret({ plaintext: JSON.stringify({ state, codeVerifier, redirectPath }) }),
        {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.isProduction,
            path: '/auth/google',
            maxAge: OAUTH_STATE_TTL_SECONDS,
        },
    )
    return client.generateAuthUrl({
        scope: SIGN_IN_SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        // A hint that skips Google's account picker for Workspace users; never trusted on its own.
        hd: config.googleWorkspaceDomain,
        prompt: 'select_account',
    })
}

/**
 * Finish the Google redirect: check state, exchange the code and verify the ID token.
 *
 * @param input.event - The callback request; its state cookie is consumed.
 * @param input.code - The `code` query parameter.
 * @param input.state - The `state` query parameter.
 * @returns The verified ID token payload and the redirect path, or null when state doesn't match.
 */
export async function completeGoogleSignIn({ event, code, state }: { event: H3Event; code: string; state: string }) {
    const stored = readOAuthState({ event })
    deleteCookie(event, OAUTH_STATE_COOKIE_NAME, { path: '/auth/google' })
    if (!stored || !secretsMatch({ expected: stored.state, actual: state })) {
        return null
    }
    const client = googleOAuthClient()
    const { tokens } = await client.getToken({ code, codeVerifier: stored.codeVerifier })
    if (!tokens.id_token) {
        return null
    }
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId })
    return { payload: ticket.getPayload() ?? null, redirectPath: stored.redirectPath }
}

/**
 * Decide whether a verified Google identity may use the dashboard.
 *
 * All three checks are required: Google's `hd` claim proves a Workspace account, the email suffix
 * guards against a misconfigured `hd`, and `email_verified` rules out unconfirmed addresses.
 *
 * @param input.payload - Claims from the verified ID token.
 * @param input.workspaceDomain - The allowed Workspace domain, e.g. `theearthbank.org`.
 * @returns `{ identity }` when allowed, else `{ rejection }`.
 */
export function checkWorkspaceIdentity({
    payload,
    workspaceDomain,
}: {
    payload: {
        sub?: string
        email?: string
        email_verified?: boolean
        hd?: string
        name?: string
        picture?: string
    } | null
    workspaceDomain: string
}): { identity: WorkspaceIdentity; rejection?: never } | { identity?: never; rejection: WorkspaceIdentityRejection } {
    if (!payload?.sub || !payload.email) {
        return { rejection: 'missing_claims' }
    }
    if (payload.email_verified !== true) {
        return { rejection: 'email_not_verified' }
    }
    const domain = workspaceDomain.toLowerCase()
    if (payload.hd?.toLowerCase() !== domain) {
        return { rejection: 'wrong_workspace' }
    }
    const email = payload.email.toLowerCase()
    if (!email.endsWith(`@${domain}`)) {
        return { rejection: 'wrong_email_domain' }
    }
    return {
        identity: {
            googleSub: payload.sub,
            email,
            name: payload.name?.trim() || email.split('@')[0]!,
            avatarUrl: payload.picture ?? null,
        },
    }
}

/**
 * Read and decrypt the OAuth state cookie.
 *
 * @param input.event - The callback request.
 * @returns The stored state, or null when missing, expired or tampered with.
 */
function readOAuthState({ event }: { event: H3Event }) {
    const encrypted = getCookie(event, OAUTH_STATE_COOKIE_NAME)
    if (!encrypted) {
        return null
    }
    const plaintext = decryptSecret({ encrypted })
    if (!plaintext) {
        return null
    }
    const parsed = OAuthState.safeParse(JSON.parse(plaintext))
    return parsed.success ? parsed.data : null
}
