// Covers the Google callback end to end against a real database: who gets an account, who is
// turned away, and that deactivated users can't sign back in. Google itself is mocked.
import { createApp, createRouter, toWebHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

const googlePayload = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock('#server/utils/auth/google.ts', async importOriginal => {
    const original = await importOriginal<typeof import('#server/utils/auth/google.ts')>()
    return {
        ...original,
        completeGoogleSignIn: async () => ({ payload: googlePayload.current, redirectPath: '/pipeline' }),
    }
})

const { cleanupTestDatabase } = setupTestDatabase()
let callGoogleCallback: (request: Request) => Promise<Response>

beforeAll(async () => {
    const { default: callbackHandler } = await import('#server/routes/auth/google/callback.get.ts')
    const app = createApp()
    app.use(createRouter().get('/auth/google/callback', callbackHandler))
    callGoogleCallback = toWebHandler(app)
})

afterAll(async () => {
    await cleanupTestDatabase()
})

beforeEach(() => {
    googlePayload.current = {
        sub: 'google-sub-drew',
        email: 'drew@theearthbank.org',
        email_verified: true,
        hd: 'theearthbank.org',
        name: 'Drew Baker',
    }
})

/**
 * Simulate Google redirecting back to the callback.
 *
 * @returns The callback's response.
 */
function returnFromGoogle() {
    return callGoogleCallback(new Request('http://localhost:3000/auth/google/callback?code=test-code&state=test-state'))
}

describe('Google sign-in callback', () => {
    it('creates an admin account on first sign-in and starts a session', async () => {
        const response = await returnFromGoogle()
        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/pipeline')
        expect(response.headers.get('set-cookie')).toContain('earthbank_dashboard_session=')

        const { db } = await import('#server/utils/db.ts')
        const user = await db().user.findUniqueOrThrow({ where: { google_sub: 'google-sub-drew' } })
        expect(user).toMatchObject({ email: 'drew@theearthbank.org', name: 'Drew Baker', role: 'admin' })
        expect(await db().session.count({ where: { user_id: user.id } })).toBe(1)
    })

    it('updates the same account on the next sign-in instead of creating another', async () => {
        googlePayload.current = { ...googlePayload.current, name: 'Drew B.' }
        await returnFromGoogle()

        const { db } = await import('#server/utils/db.ts')
        const users = await db().user.findMany({ where: { email: 'drew@theearthbank.org' } })
        expect(users).toHaveLength(1)
        expect(users[0]?.name).toBe('Drew B.')
    })

    it.each([
        ['a personal Gmail account', { email: 'someone@gmail.com', hd: undefined, sub: 'google-sub-gmail' }],
        ['another Workspace', { email: 'someone@example.org', hd: 'example.org', sub: 'google-sub-other' }],
        ['an unverified email', { email_verified: false, sub: 'google-sub-unverified' }],
    ])('turns away %s without creating an account', async (_label, overrides) => {
        googlePayload.current = { ...googlePayload.current, ...overrides }
        const response = await returnFromGoogle()
        expect(response.headers.get('location')).toBe('/login?error=wrong_account')
        expect(response.headers.get('set-cookie')).toBeNull()

        const { db } = await import('#server/utils/db.ts')
        expect(await db().user.findUnique({ where: { google_sub: String(overrides.sub) } })).toBeNull()
    })

    it('refuses deactivated users', async () => {
        const { db } = await import('#server/utils/db.ts')
        const { deactivateUser } = await import('#server/database/users.ts')
        const user = await db().user.findUniqueOrThrow({ where: { google_sub: 'google-sub-drew' } })
        await deactivateUser({ userId: user.id, deactivatedAt: new Date() })

        const response = await returnFromGoogle()
        expect(response.headers.get('location')).toBe('/login?error=deactivated')
        expect(await db().session.count({ where: { user_id: user.id } })).toBe(0)
    })
})
