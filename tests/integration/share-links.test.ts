// Covers the funder-facing share link: it shows only safe fields (no emails, notes or declined asks),
// needs the right password once per browser, and stops working when turned off.
import { createApp, createRouter, toWebHandler } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

// Route files declare OpenAPI meta through Nitro's runtime, which only exists inside a Nitro build.
vi.mock('nitropack/runtime', () => ({ defineRouteMeta: () => undefined }))

const { cleanupTestDatabase } = setupTestDatabase()
let userId: string

beforeAll(async () => {
    const { ensureDefaultGoals } = await import('#server/database/goals.ts')
    const { createFunderWithDetails } = await import('#server/utils/funders.ts')
    await ensureDefaultGoals()
    userId = (await createTestUser({ email: 'drew@theearthbank.org', name: 'Drew' })).id
    const hewlettId = await createFunderWithDetails({
        name: 'Hewlett Foundation',
        geoFocus: 'Africa, India',
        notes: 'Internal: Jim prefers short decks.',
        contacts: [{ name: 'Jim Stephenson', email: 'jstephenson@hewlett.org' }],
        opportunity: {
            goalType: 'design_grant',
            stage: 'in_committee',
            amountCents: 100_000_000,
        },
    })
    const { db } = await import('#server/utils/db.ts')
    await db().opportunity.updateMany({
        where: { funder_id: hewlettId },
        data: { next_step: 'Send Jim the v1 and v2 budgets. Then chase the board pack and ask about timing.' },
    })
    await createFunderWithDetails({
        name: 'FMO',
        contacts: [{ name: 'C. Nyambori', email: 'c.nyambori@fmo.nl' }],
        opportunity: { goalType: 'lending_capital', stage: 'proposal', amountCents: 500_000_000 },
    })
    await createFunderWithDetails({
        name: 'Declined Fund',
        opportunity: { goalType: 'design_grant', stage: 'lost', amountCents: 10_000_000 },
    })
})

afterAll(async () => {
    await cleanupTestDatabase()
})

describe('buildSharedPipeline', () => {
    it('shows names, focus, amounts, stages and short next steps, and nothing private', async () => {
        const { buildSharedPipeline } = await import('#server/utils/share-links.ts')
        const pipeline = await buildSharedPipeline({ showNextSteps: true })
        expect(pipeline.design_grants).toEqual([
            {
                organization: 'Hewlett Foundation',
                contacts: ['Jim Stephenson'],
                geo_focus: ['Africa', 'India'],
                amount_cents: 100_000_000,
                stage: 'in_committee',
                focus_areas: ['region:africa', 'IN'],
                next_step: 'Send Jim the v1 and v2 budgets.',
            },
        ])
        expect(pipeline.lending_capital.map(ask => ask.organization)).toEqual(['FMO'])
        const everything = JSON.stringify(pipeline)
        expect(everything).not.toContain('@')
        expect(everything).not.toContain('Internal')
        expect(everything).not.toContain('Declined Fund')
    })

    it('leaves out the data for parts the link hides', async () => {
        const { buildSharedPipeline } = await import('#server/utils/share-links.ts')
        const { ShareSections } = await import('#shared/schemas/index.ts')
        const pipeline = await buildSharedPipeline({
            showNextSteps: true,
            sections: ShareSections.parse({ table: false, map: false, lending_capital: false, stats: false }),
        })
        expect(pipeline.lending_capital).toEqual([])
        expect(pipeline.design_grant_goals).toEqual([])
        expect(pipeline.design_grants[0]).toMatchObject({
            organization: 'Hewlett Foundation',
            contacts: [],
            geo_focus: [],
            focus_areas: [],
            next_step: null,
        })
        expect(JSON.stringify(pipeline)).not.toContain('Jim Stephenson')
    })

    it('leaves next steps out when the link hides them', async () => {
        const { buildSharedPipeline } = await import('#server/utils/share-links.ts')
        const pipeline = await buildSharedPipeline({ showNextSteps: false })
        expect(pipeline.design_grants.every(ask => ask.next_step === null)).toBe(true)
    })
})

describe('shortNextStep', () => {
    it('keeps the first sentence and trims long ones at a word', async () => {
        const { shortNextStep } = await import('#server/utils/share-links.ts')
        expect(shortNextStep({ text: 'send materials; set intro call.' })).toBe('Send materials')
        expect(shortNextStep({ text: null })).toBeNull()
        const long = shortNextStep({ text: `${'word '.repeat(60)}end.` })!
        expect(long.length).toBeLessThanOrEqual(141)
        expect(long.endsWith('…')).toBe(true)
    })
})

describe('share link routes', () => {
    let call: (request: Request) => Promise<Response>
    let token: string
    let shareLinkId: string

    beforeAll(async () => {
        const { createShareLinkRow } = await import('#server/database/share-links.ts')
        const { encryptSecret, hashToken, newOpaqueToken } = await import('#server/utils/crypto.ts')
        const { hashPassword } = await import('#server/utils/passwords.ts')
        token = newOpaqueToken()
        shareLinkId = (
            await createShareLinkRow({
                label: 'Funders',
                tokenHash: hashToken({ token }),
                tokenEncrypted: encryptSecret({ plaintext: token }),
                passwordHash: await hashPassword({ password: 'green-ledger-42' }),
                passwordEncrypted: encryptSecret({ plaintext: 'green-ledger-42' }),
                showNextSteps: true,
                sections: {},
                createdByUserId: userId,
            })
        ).id
        const { default: view } = await import('#server/routes/v1/shared/[token]/index.get.ts')
        const { default: unlock } = await import('#server/routes/v1/shared/[token]/unlock.post.ts')
        const app = createApp()
        app.use(createRouter().get('/v1/shared/:token', view).post('/v1/shared/:token/unlock', unlock))
        call = toWebHandler(app)
    })

    /**
     * Try a password.
     *
     * @param input.password - The password.
     * @returns The response.
     */
    function tryPassword({ password }: { password: string }) {
        return call(
            new Request(`http://localhost/v1/shared/${token}/unlock`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ password }),
            }),
        )
    }

    it('asks for the password, refuses a wrong one, and opens with the right one', async () => {
        expect((await call(new Request(`http://localhost/v1/shared/${token}`))).status).toBe(401)
        expect((await tryPassword({ password: 'nope' })).status).toBe(400)

        const unlocked = await tryPassword({ password: 'green-ledger-42' })
        expect(unlocked.status).toBe(204)
        const cookie = unlocked.headers.get('set-cookie')!.split(';')[0]!
        const view = await call(new Request(`http://localhost/v1/shared/${token}`, { headers: { cookie } }))
        expect(view.status).toBe(200)
        expect((await view.json()).design_grants[0].organization).toBe('Hewlett Foundation')
    })

    it('rejects a tampered cookie and an unknown link', async () => {
        const view = await call(
            new Request(`http://localhost/v1/shared/${token}`, {
                headers: { cookie: `earthbank_dashboard_share_${shareLinkId}=${shareLinkId}.9999999999999~forged` },
            }),
        )
        expect(view.status).toBe(401)
        expect((await call(new Request('http://localhost/v1/shared/not-a-real-token'))).status).toBe(404)
    })

    it('opens without a password when the link has none', async () => {
        const { createShareLinkRow } = await import('#server/database/share-links.ts')
        const { encryptSecret, hashToken, newOpaqueToken } = await import('#server/utils/crypto.ts')
        const openToken = newOpaqueToken()
        await createShareLinkRow({
            label: 'Open link',
            tokenHash: hashToken({ token: openToken }),
            tokenEncrypted: encryptSecret({ plaintext: openToken }),
            passwordHash: null,
            passwordEncrypted: null,
            showNextSteps: false,
            sections: {},
            createdByUserId: userId,
        })
        const view = await call(new Request(`http://localhost/v1/shared/${openToken}`))
        expect(view.status).toBe(200)
        expect((await view.json()).design_grants[0].next_step).toBeNull()
    })

    it('stops working once turned off', async () => {
        const { revokeShareLinkRow } = await import('#server/database/share-links.ts')
        await revokeShareLinkRow({ shareLinkId, revokedAt: new Date() })
        expect((await tryPassword({ password: 'green-ledger-42' })).status).toBe(404)
    })
})
