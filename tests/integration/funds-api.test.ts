// Covers the Funds API: adding funds (no duplicates), the list filters the team ranks by
// (working capital ≥ $500K, recent close, check size, completeness, region), team edits with audit
// entries, due diligence answers, rejecting findings, and research settings.
import { createApp, createRouter, eventHandler, toWebHandler } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

vi.mock('nitropack/runtime', () => ({ defineRouteMeta: () => undefined }))
const queuedResearch = vi.hoisted(() => [] as { fundManagerId: string; isPriority: boolean }[])
vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueEmail: async () => undefined,
    enqueueFundResearch: async (input: { fundManagerId: string; isPriority: boolean }) => {
        queuedResearch.push(input)
        return 'queued'
    },
    enqueuePublicInvestmentSync: async () => 'queued',
}))

const { cleanupTestDatabase } = setupTestDatabase()
let callApi: (request: Request) => Promise<Response>
let userId: string
const ids: Record<string, string> = {}

beforeAll(async () => {
    userId = (await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })).id
    const { findUser } = await import('#server/database/users.ts')
    const routes = {
        list: (await import('#server/routes/v1/funds/index.get.ts')).default,
        create: (await import('#server/routes/v1/funds/index.post.ts')).default,
        get: (await import('#server/routes/v1/funds/[id].get.ts')).default,
        patch: (await import('#server/routes/v1/funds/[id].patch.ts')).default,
        answer: (await import('#server/routes/v1/funds/[id]/diligence/[question].put.ts')).default,
        clear: (await import('#server/routes/v1/funds/[id]/diligence/[question].delete.ts')).default,
        reject: (await import('#server/routes/v1/fund-findings/[id]/reject.post.ts')).default,
        restore: (await import('#server/routes/v1/fund-findings/[id]/restore.post.ts')).default,
        status: (await import('#server/routes/v1/fund-research/status.get.ts')).default,
        settings: (await import('#server/routes/v1/fund-research/settings.patch.ts')).default,
    }
    const app = createApp()
    app.use(
        eventHandler(async event => {
            const user = await findUser({ userId })
            event.context.auth = {
                user: { id: user!.id, email: user!.email, name: user!.name, avatar_url: null, role: 'admin' },
                actor: { type: 'user', userId: user!.id },
                sessionId: 'ses_test',
            }
        }),
    )
    app.use(
        createRouter()
            .get('/v1/funds', routes.list)
            .post('/v1/funds', routes.create)
            .get('/v1/funds/:id', routes.get)
            .patch('/v1/funds/:id', routes.patch)
            .put('/v1/funds/:id/diligence/:question', routes.answer)
            .delete('/v1/funds/:id/diligence/:question', routes.clear)
            .post('/v1/fund-findings/:id/reject', routes.reject)
            .post('/v1/fund-findings/:id/restore', routes.restore)
            .get('/v1/fund-research/status', routes.status)
            .patch('/v1/fund-research/settings', routes.settings),
    )
    callApi = toWebHandler(app)

    // Three funds with research values already worked out.
    const { addFund } = await import('#server/utils/funds/add-fund.ts')
    const { updateFundManagerColumns } = await import('#server/database/fund-managers.ts')
    const now = new Date('2026-10-17T00:00:00Z')
    ids.big = (
        await addFund({ name: 'Big Working Capital Fund', websiteUrl: 'https://bigwc.example', origin: 'seed', now })
    ).fund.id
    ids.small = (await addFund({ name: 'Small Ticket Lender', websiteUrl: null, origin: 'seed', now })).fund.id
    ids.project = (
        await addFund({ name: 'Project Debt Partners', websiteUrl: null, origin: 'spider_person', now })
    ).fund.id
    await updateFundManagerColumns({
        fundManagerId: ids.big,
        data: {
            aum_cents: 50_000_000_000n,
            check_min_cents: 50_000_000n,
            check_max_cents: 500_000_000n,
            has_working_capital_loans: true,
            max_working_capital_loan_cents: 200_000_000n,
            last_fund_close_on: new Date('2025-06-01T00:00:00Z'),
            research_completeness: 80,
            focus_areas: ['KE', 'UG'],
            ticket_fit: 'fits',
            lender_archetype: 'climate_private_debt',
            lends_local_currency: true,
            loan_types: ['working_capital', 'term_debt'],
        },
    })
    await updateFundManagerColumns({
        fundManagerId: ids.small,
        data: {
            check_min_cents: 1_000_000n,
            check_max_cents: 10_000_000n,
            has_working_capital_loans: true,
            max_working_capital_loan_cents: 10_000_000n,
            research_completeness: 30,
            focus_areas: ['global'],
        },
    })
    await updateFundManagerColumns({
        fundManagerId: ids.project,
        data: { last_fund_close_on: new Date('2019-01-01T00:00:00Z'), research_completeness: 55, focus_areas: ['BR'] },
    })
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * Call the API as the signed-in user.
 *
 * @param input.method - HTTP method.
 * @param input.path - Path and query.
 * @param input.body - JSON body.
 * @returns Status and parsed JSON.
 */
async function request({ method = 'GET', path, body }: { method?: string; path: string; body?: unknown }) {
    const response = await callApi(
        new Request(`http://localhost${path}`, {
            method,
            headers: body ? { 'content-type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        }),
    )
    return { status: response.status, json: response.status === 204 ? null : await response.json() }
}

/**
 * Names of the funds a list query returns.
 *
 * @param input.query - Query string.
 * @returns Sorted names.
 */
async function listNames({ query }: { query: string }) {
    const { json } = await request({ path: `/v1/funds?${query}` })
    return (json.data as { name: string }[]).map(fund => fund.name).sort()
}

describe('adding funds', () => {
    it('needs a name and website; the LinkedIn page is optional', async () => {
        const noWebsite = await request({ method: 'POST', path: '/v1/funds', body: { name: 'Open Road Impact' } })
        expect(noWebsite.status).toBe(422)
        const badLinkedin = await request({
            method: 'POST',
            path: '/v1/funds',
            body: {
                name: 'Open Road Impact',
                website_url: 'https://openroadimpact.example',
                linkedin_url: 'https://example.com/x',
            },
        })
        expect(badLinkedin.status).toBe(422)
    })

    it('adds a fund, queues its research ahead of the spider, and refuses duplicates', async () => {
        const created = await request({
            method: 'POST',
            path: '/v1/funds',
            body: {
                name: 'Open Road Impact',
                website_url: 'https://openroadimpact.example',
                linkedin_url: 'https://ke.linkedin.com/company/open-road-impact/',
            },
        })
        expect(created.status).toBe(201)
        expect(created.json).toMatchObject({
            name: 'Open Road Impact',
            origin: 'manual',
            research_status: 'queued',
            website_url: 'https://openroadimpact.example',
            linkedin_url: 'https://www.linkedin.com/company/open-road-impact',
        })
        expect(queuedResearch).toContainEqual({ fundManagerId: created.json.id, isPriority: true })

        const duplicate = await request({
            method: 'POST',
            path: '/v1/funds',
            body: { name: 'Open Road Impact, LLC', website_url: 'https://another-site.example' },
        })
        expect(duplicate.status).toBe(409)
        const sameSite = await request({
            method: 'POST',
            path: '/v1/funds',
            body: { name: 'Big WC', website_url: 'https://www.bigwc.example/about' },
        })
        expect(sameSite.status).toBe(409)
    })
})

describe('list filters', () => {
    it('finds working-capital lenders, and those lending $500K or more', async () => {
        expect(await listNames({ query: 'working_capital=any' })).toEqual([
            'Big Working Capital Fund',
            'Small Ticket Lender',
        ])
        expect(await listNames({ query: 'working_capital=min_500k' })).toEqual(['Big Working Capital Fund'])
    })

    it('filters by recent fund close, AUM, check size and completeness', async () => {
        expect(await listNames({ query: 'closed_since=2024-01-01' })).toEqual(['Big Working Capital Fund'])
        expect(await listNames({ query: 'min_aum_usd=100000000' })).toEqual(['Big Working Capital Fund'])
        // "Lends $500K": check-size ranges covering $500K.
        expect(await listNames({ query: 'check_size_min_usd=500000&check_size_max_usd=500000' })).toEqual([
            'Big Working Capital Fund',
        ])
        expect(await listNames({ query: 'min_completeness=50' })).toEqual([
            'Big Working Capital Fund',
            'Project Debt Partners',
        ])
    })

    it('filters by ticket fit, lender type and local-currency lending', async () => {
        expect(await listNames({ query: 'ticket_fit=fits' })).toEqual(['Big Working Capital Fund'])
        expect(await listNames({ query: 'lender_archetype=climate_private_debt' })).toEqual([
            'Big Working Capital Fund',
        ])
        expect(await listNames({ query: 'local_currency=true' })).toEqual(['Big Working Capital Fund'])
    })

    it('matches regions by country, and includes global funds', async () => {
        expect(await listNames({ query: 'focus_area=region:eastern_africa' })).toEqual([
            'Big Working Capital Fund',
            'Small Ticket Lender',
        ])
        expect(await listNames({ query: 'loan_type=term_debt' })).toEqual(['Big Working Capital Fund'])
    })
})

describe('team fields and diligence', () => {
    it('updates stage, tags and notes with an audit entry', async () => {
        const { status, json } = await request({
            method: 'PATCH',
            path: `/v1/funds/${ids.small}`,
            body: { stage: 'shortlisted', fit_tags: ['worked_example'], notes: 'Strong on micro tickets.' },
        })
        expect(status).toBe(200)
        expect(json).toMatchObject({
            stage: 'shortlisted',
            fit_tags: ['worked_example'],
            notes: 'Strong on micro tickets.',
        })
        const { db } = await import('#server/utils/db.ts')
        expect(await db().auditLog.count({ where: { action: 'fund.updated', entity_id: ids.small } })).toBe(1)
    })

    it('records and clears diligence answers, updating completeness', async () => {
        const answered = await request({
            method: 'PUT',
            path: `/v1/funds/${ids.small}/diligence/time_to_close`,
            body: { answer: 'About six weeks.' },
        })
        expect(
            answered.json.diligence.find((item: { question: string }) => item.question === 'time_to_close'),
        ).toMatchObject({
            answer: 'About six weeks.',
            source: 'manual',
            answered_by: { name: 'Leslie' },
        })
        expect(answered.json.diligence_completeness).toBe(14)
        expect(
            (
                await request({
                    method: 'PUT',
                    path: `/v1/funds/${ids.small}/diligence/favorite_food`,
                    body: { answer: 'x' },
                })
            ).status,
        ).toBe(404)
        const cleared = await request({ method: 'DELETE', path: `/v1/funds/${ids.small}/diligence/time_to_close` })
        expect(cleared.json.diligence_completeness).toBe(0)
    })
})

describe('findings', () => {
    it('rejects and restores a finding', async () => {
        const { saveResearchResults } = await import('#server/database/fund-research.ts')
        await saveResearchResults({
            fundManagerId: ids.project,
            researchRunId: null,
            findings: [
                {
                    field: 'year_established',
                    value: { year: 2012 },
                    valueKey: '{"year":2012}',
                    isList: false,
                    confidence: 0.9,
                    sources: [
                        {
                            url: 'https://projectdebt.example/about',
                            title: 'About',
                            kind: 'fund_website',
                            quote: 'Founded in 2012',
                        },
                    ],
                },
            ],
            people: [],
            affiliations: [],
            diligence: [],
            now: new Date(),
        })
        const before = await request({ path: `/v1/funds/${ids.project}` })
        const finding = before.json.findings[0]
        expect(finding.sources[0]).toMatchObject({ domain: 'projectdebt.example', quote: 'Founded in 2012' })

        const rejected = await request({ method: 'POST', path: `/v1/fund-findings/${finding.id}/reject` })
        expect(rejected.json.findings).toEqual([])
        const restored = await request({ method: 'POST', path: `/v1/fund-findings/${finding.id}/restore` })
        expect(restored.json.findings.map((item: { id: string }) => item.id)).toEqual([finding.id])
    })
})

describe('research settings and status', () => {
    it('saves settings and reports the list against its limit', async () => {
        const saved = await request({
            method: 'PATCH',
            path: '/v1/fund-research/settings',
            body: { max_funds: 250, spider_enabled: false },
        })
        expect(saved.json).toMatchObject({ max_funds: 250, spider_enabled: false, monthly_budget_usd: 300 })
        expect(
            (await request({ method: 'PATCH', path: '/v1/fund-research/settings', body: { max_funds: 5000 } })).status,
        ).toBe(422)
        const status = await request({ path: '/v1/fund-research/status' })
        expect(status.json).toMatchObject({
            funds: 4,
            max_funds: 250,
            queued: 4,
            spider_enabled: false,
            month_spend_usd: 0,
        })
    })
})

describe('regional focus', () => {
    it("keeps the team's regional focus over research's, and can go back to research's", async () => {
        const { refreshFundResearchValues } = await import('#server/utils/funds/refresh-values.ts')
        const { saveResearchResults } = await import('#server/database/fund-research.ts')
        await saveResearchResults({
            fundManagerId: ids.small,
            researchRunId: null,
            findings: [
                {
                    field: 'geographic_focus',
                    value: { codes: ['BR'], text: 'Brazil' },
                    valueKey: 'brazil',
                    isList: false,
                    confidence: 0.9,
                    sources: [
                        {
                            url: 'https://smallticket.example/where',
                            title: 'Where',
                            kind: 'fund_website',
                            quote: 'Brazil',
                        },
                    ],
                },
            ],
            people: [],
            affiliations: [],
            diligence: [],
            now: new Date(),
        })
        const set = await request({
            method: 'PATCH',
            path: `/v1/funds/${ids.small}`,
            body: { focus_areas: ['region:eastern_africa', 'IN', 'IN'] },
        })
        expect(set.json).toMatchObject({ focus_areas: ['region:eastern_africa', 'IN'], is_focus_set_by_team: true })
        // A research refresh doesn't overwrite it.
        await refreshFundResearchValues({ fundManagerId: ids.small })
        expect((await request({ path: `/v1/funds/${ids.small}` })).json.focus_areas).toEqual([
            'region:eastern_africa',
            'IN',
        ])
        expect(await listNames({ query: 'focus_area=region:eastern_africa' })).toContain('Small Ticket Lender')
        expect(
            (await request({ method: 'PATCH', path: `/v1/funds/${ids.small}`, body: { focus_areas: ['atlantis'] } }))
                .status,
        ).toBe(422)
        // Back to research's focus.
        const cleared = await request({
            method: 'PATCH',
            path: `/v1/funds/${ids.small}`,
            body: { focus_areas: null },
        })
        expect(cleared.json).toMatchObject({ focus_areas: ['BR'], is_focus_set_by_team: false })
    })
})
