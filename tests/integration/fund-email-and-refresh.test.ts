// Covers adding and refreshing funds by email ("research this fund", with or without its website),
// and correcting a fund's website or LinkedIn page: research from the old address is retired, a
// refresh is queued, and the team's own fields are never touched.
import { createApp, createRouter, eventHandler, toWebHandler } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fakeAi } from '#root/tests/helpers/fake-ai.ts'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

vi.mock('nitropack/runtime', () => ({ defineRouteMeta: () => undefined }))
const queuedResearch = vi.hoisted(() => [] as { fundManagerId: string; isPriority: boolean }[])
vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueEmail: async () => undefined,
    enqueueFunderBackfill: async () => undefined,
    enqueueFundResearch: async (input: { fundManagerId: string; isPriority: boolean }) => {
        queuedResearch.push(input)
        return 'queued'
    },
    enqueuePublicInvestmentSync: async () => 'queued',
}))

const { cleanupTestDatabase } = setupTestDatabase()
const now = new Date('2026-10-17T12:00:00Z')
let leslie: { id: string; name: string; email: string }

beforeAll(async () => {
    const user = await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })
    leslie = { id: user.id, name: user.name, email: user.email }
})

afterAll(async () => {
    await cleanupTestDatabase()
})

describe('funds by email', () => {
    it('adds the fund a forwarded email is about, even without its website, and researches it', async () => {
        const { carryOutEmailInstructions } = await import('#server/utils/mail/instructions.ts')
        const ai = fakeAi({
            answers: [],
            toolScripts: [
                {
                    calls: [
                        { name: 'find_funds', input: { query: 'Kawisafi' } },
                        {
                            name: 'add_fund',
                            input: {
                                name: 'KawiSafi Ventures',
                                website_url: null,
                                linkedin_url: 'https://www.linkedin.com/company/kawisafi-ventures',
                                notes: 'Introduced by Acumen.',
                            },
                        },
                    ],
                    reply: 'Added KawiSafi Ventures to Funds and started researching it.',
                },
            ],
        })
        const result = await carryOutEmailInstructions({
            sender: leslie,
            subject: 'Fwd: Intro to KawiSafi',
            instructions: 'Please research this fund.',
            forwarded: {
                messageIdHeader: '<intro@example.com>',
                from: 'partner@acumen.org',
                to: ['leslie@theearthbank.org'],
                cc: [],
                sentAt: now,
                subject: 'Intro to KawiSafi',
                text: 'Meet the team at KawiSafi Ventures, a clean-energy fund.',
            },
            ai: ai.provider,
            today: '2026-10-17',
        })
        expect(ai.toolResults[0]).toEqual({ name: 'find_funds', result: 'No fund matches.' })
        expect(ai.toolResults[1]!.result).toContain('Added KawiSafi Ventures')
        expect(result.actions[0]!.description).toContain('the research will look for its website')

        const { listFundManagers } = await import('#server/database/fund-managers.ts')
        const fund = (await listFundManagers({ limit: 1000 })).find(row => row.name === 'KawiSafi Ventures')!
        expect(fund).toMatchObject({
            website_url: null,
            linkedin_url: 'https://www.linkedin.com/company/kawisafi-ventures',
            notes: 'Introduced by Acumen.',
            origin: 'manual',
        })
        expect(queuedResearch).toContainEqual({ fundManagerId: fund.id, isPriority: true })
        const { db } = await import('#server/utils/db.ts')
        expect(await db().auditLog.count({ where: { action: 'fund.created', entity_id: fund.id } })).toBe(1)
    })

    it('refreshes a fund that is already on the list instead of adding it twice', async () => {
        const { carryOutEmailInstructions } = await import('#server/utils/mail/instructions.ts')
        const { listFundManagers } = await import('#server/database/fund-managers.ts')
        const fund = (await listFundManagers({ limit: 1000 })).find(row => row.name === 'KawiSafi Ventures')!
        queuedResearch.length = 0
        const ai = fakeAi({
            answers: [],
            toolScripts: [
                {
                    calls: [
                        {
                            name: 'add_fund',
                            input: {
                                name: 'Kawisafi Ventures Ltd',
                                website_url: null,
                                linkedin_url: null,
                                notes: null,
                            },
                        },
                        { name: 'research_fund', input: { fund_id: fund.id } },
                    ],
                    reply: 'KawiSafi was already on the list; refreshing its research.',
                },
            ],
        })
        const result = await carryOutEmailInstructions({
            sender: leslie,
            subject: 'Update KawiSafi',
            instructions: 'Refresh the research on KawiSafi.',
            forwarded: null,
            ai: ai.provider,
            today: '2026-10-17',
        })
        expect(ai.toolResults[0]!.result).toContain('already on the list')
        expect(result.actions.map(action => action.description)).toEqual([
            'Started refreshing the research on KawiSafi Ventures',
        ])
        expect(queuedResearch).toEqual([{ fundManagerId: fund.id, isPriority: true }])
    })
})

describe('correcting a website', () => {
    it('retires research from the old website, queues a refresh and keeps the team fields', async () => {
        const { addFund } = await import('#server/utils/funds/add-fund.ts')
        const { saveResearchResults, listFundFindings, listFundPeople } =
            await import('#server/database/fund-research.ts')
        const { updateFundManagerColumns } = await import('#server/database/fund-managers.ts')
        const { fund } = await addFund({
            name: 'Arq Capital',
            websiteUrl: 'https://wrong-arq.example',
            origin: 'seed',
            now,
        })
        await updateFundManagerColumns({ fundManagerId: fund.id, data: { notes: 'Our notes', stage: 'sourced' } })
        const wrongSite = {
            url: 'https://wrong-arq.example/about',
            title: 'About',
            kind: 'fund_website' as const,
            quote: 'Founded in 1999',
        }
        const news = {
            url: 'https://news.example/arq',
            title: 'Arq news',
            kind: 'news' as const,
            quote: 'Arq Capital lends to SMEs',
        }
        await saveResearchResults({
            fundManagerId: fund.id,
            researchRunId: null,
            findings: [
                {
                    field: 'year_established',
                    value: { year: 1999 },
                    valueKey: '{"year":1999}',
                    isList: false,
                    confidence: 0.9,
                    sources: [wrongSite],
                },
                {
                    field: 'website_url',
                    value: { url: 'https://wrong-arq.example/' },
                    valueKey: 'wrong',
                    isList: false,
                    confidence: 0.9,
                    sources: [wrongSite],
                },
                {
                    field: 'summary',
                    value: { text: 'Arq Capital lends to SMEs in Africa.' },
                    valueKey: 'summary',
                    isList: false,
                    confidence: 0.9,
                    sources: [news],
                },
            ],
            people: [
                {
                    name: 'Wrong Person',
                    nameKey: 'wrong person',
                    title: 'CEO',
                    isPrincipal: true,
                    linkedinUrl: null,
                    email: null,
                    bioSummary: null,
                    sources: [wrongSite],
                },
            ],
            affiliations: [],
            diligence: [],
            now,
        })
        const { saveManualDiligenceAnswer } = await import('#server/database/fund-research.ts')
        await saveManualDiligenceAnswer({
            fundManagerId: fund.id,
            question: 'fx_risk',
            answer: 'Lends in USD (from call)',
            userId: leslie.id,
        })

        const { findUser } = await import('#server/database/users.ts')
        const { default: patchFund } = await import('#server/routes/v1/funds/[id].patch.ts')
        const app = createApp()
        app.use(
            eventHandler(async event => {
                const user = await findUser({ userId: leslie.id })
                event.context.auth = {
                    user: { id: user!.id, email: user!.email, name: user!.name, avatar_url: null, role: 'admin' },
                    actor: { type: 'user', userId: user!.id },
                    sessionId: 'ses_test',
                }
            }),
        )
        app.use(createRouter().patch('/v1/funds/:id', patchFund))
        queuedResearch.length = 0
        const response = await toWebHandler(app)(
            new Request(`http://localhost/v1/funds/${fund.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ website_url: 'https://arqcapital.example' }),
            }),
        )
        expect(response.status).toBe(200)
        const detail = await response.json()
        expect(detail).toMatchObject({
            website_url: 'https://arqcapital.example',
            notes: 'Our notes',
            stage: 'sourced',
            research_status: 'queued',
        })
        // Research from the wrong site is retired; facts from elsewhere stay.
        expect((await listFundFindings({ fundManagerId: fund.id })).map(finding => finding.field)).toEqual(['summary'])
        expect(await listFundPeople({ fundManagerId: fund.id })).toEqual([])
        // A person's diligence answer is untouched.
        expect(detail.diligence.find((item: { question: string }) => item.question === 'fx_risk')).toMatchObject({
            answer: 'Lends in USD (from call)',
            source: 'manual',
        })
        expect(queuedResearch).toEqual([{ fundManagerId: fund.id, isPriority: true }])

        // Saving the same website again doesn't trigger another refresh.
        queuedResearch.length = 0
        await toWebHandler(app)(
            new Request(`http://localhost/v1/funds/${fund.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ website_url: 'https://arqcapital.example', notes: 'Updated notes' }),
            }),
        )
        expect(queuedResearch).toEqual([])
    })
})
