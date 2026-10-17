// Covers a fund research run end to end: verified findings are stored with their sources and the
// rest dropped, people and work history are kept, rejected values never come back, a person's
// diligence answer is never overwritten, sort columns are recomputed, and the spider adds lenders
// from work history (only lenders, never past the limit or the budget).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fakeAi, fakeWebResearcher } from '#root/tests/helpers/fake-ai.ts'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'
import type { WebReader } from '#server/utils/web/types.ts'

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
const now = new Date('2026-10-17T12:00:00Z')
let userId: string
let iungoId: string

const ABOUT_PAGE = {
    url: 'https://www.iungocapital.com/about',
    title: 'About us',
    text: [
        'Iungo Capital was founded in 2017 and is headquartered in Nairobi, Kenya.',
        'We provide asset finance and working capital loans of USD 50,000 to USD 1,000,000 to SMEs in East Africa.',
        'Our team: Jane Mwangi, Managing Partner. Jane previously worked at Acumen Capital Partners and studied at Strathmore University.',
        'In 2025 we reached a first close of USD 40 million for Iungo Fund II.',
        'Email: hello@iungocapital.com',
    ].join('\n'),
}

/**
 * The tool calls a typical run makes, including some that must be dropped.
 *
 * @returns Scripted calls.
 */
function iungoCalls() {
    return [
        {
            name: 'record_finding',
            input: {
                finding: { field: 'year_established', value: { year: 2017 } },
                source_urls: [ABOUT_PAGE.url],
                quote: 'Iungo Capital was founded in 2017',
                confidence: 0.95,
            },
        },
        {
            name: 'record_finding',
            input: {
                finding: { field: 'headquarters', value: { city: 'Nairobi', country: 'KE' } },
                source_urls: [ABOUT_PAGE.url],
                quote: 'headquartered in Nairobi, Kenya',
                confidence: 0.95,
            },
        },
        {
            name: 'record_finding',
            input: {
                finding: { field: 'loan_types', value: { types: ['asset_finance', 'working_capital'] } },
                source_urls: [ABOUT_PAGE.url],
                quote: 'We provide asset finance and working capital loans',
                confidence: 0.9,
            },
        },
        {
            name: 'record_finding',
            input: {
                finding: { field: 'check_size', value: { min: 50000, max: 1000000, currency: 'USD', note: null } },
                source_urls: [ABOUT_PAGE.url],
                quote: 'of USD 50,000 to USD 1,000,000 to SMEs',
                confidence: 0.9,
            },
        },
        {
            name: 'record_finding',
            input: {
                finding: {
                    field: 'fund_raise',
                    value: {
                        fund_name: 'Iungo Fund II',
                        size: { amount: 40000000, currency: 'USD' },
                        close_type: 'first_close',
                        closed_on: '2025',
                    },
                },
                source_urls: [ABOUT_PAGE.url],
                quote: 'In 2025 we reached a first close of USD 40 million',
                confidence: 0.85,
            },
        },
        // Made up: the page never says this.
        {
            name: 'record_finding',
            input: {
                finding: { field: 'aum', value: { amount: 500000000, currency: 'USD', as_of: '2025' } },
                source_urls: [ABOUT_PAGE.url],
                quote: 'Iungo manages USD 500 million',
                confidence: 0.9,
            },
        },
        // Too unsure.
        {
            name: 'record_finding',
            input: {
                finding: { field: 'employee_count', value: { count: 25 } },
                source_urls: [ABOUT_PAGE.url],
                quote: 'Iungo Capital was founded in 2017',
                confidence: 0.4,
            },
        },
        {
            name: 'record_person',
            input: {
                name: 'Jane Mwangi',
                title: 'Managing Partner',
                is_principal: true,
                linkedin_url: null,
                email: 'jane@iungocapital.com',
                bio_summary: null,
                source_urls: [ABOUT_PAGE.url],
                quote: 'Jane Mwangi, Managing Partner',
            },
        },
        {
            name: 'record_affiliation',
            input: {
                person_name: 'Jane Mwangi',
                organization_name: 'Acumen Capital Partners',
                organization_kind: 'investor',
                relation: 'employment',
                title: null,
                start_year: null,
                end_year: null,
                source_urls: [ABOUT_PAGE.url],
                quote: 'Jane previously worked at Acumen Capital Partners',
            },
        },
        {
            name: 'record_affiliation',
            input: {
                person_name: 'Jane Mwangi',
                organization_name: 'Strathmore University',
                organization_kind: 'school',
                relation: 'education',
                title: null,
                start_year: null,
                end_year: null,
                source_urls: [ABOUT_PAGE.url],
                quote: 'studied at Strathmore University',
            },
        },
        {
            name: 'answer_diligence',
            input: {
                question: 'fx_risk',
                answer: 'Lends in US dollars.',
                source_urls: [ABOUT_PAGE.url],
                quote: 'working capital loans of USD 50,000',
                confidence: 0.8,
            },
        },
        {
            name: 'answer_diligence',
            input: {
                question: 'default_rate',
                answer: 'About 2%.',
                source_urls: [ABOUT_PAGE.url],
                quote: 'Iungo Capital was founded in 2017',
                confidence: 0.9,
            },
        },
    ]
}

beforeAll(async () => {
    userId = (await createTestUser({ email: 'drew@theearthbank.org', name: 'Drew' })).id
    const { addFund } = await import('#server/utils/funds/add-fund.ts')
    iungoId = (await addFund({ name: 'Iungo Capital', websiteUrl: null, origin: 'seed', now })).fund.id
    // A person already answered the default rate; the AI must not overwrite it.
    const { saveManualDiligenceAnswer } = await import('#server/database/fund-research.ts')
    await saveManualDiligenceAnswer({
        fundManagerId: iungoId,
        question: 'default_rate',
        answer: 'Under 3% (call with Jane)',
        userId,
    })
})

afterAll(async () => {
    await cleanupTestDatabase()
})

describe('researchFund', () => {
    it('stores only verified findings, with their sources', async () => {
        const { researchFund } = await import('#server/utils/funds/research.ts')
        const { researcher, toolResults } = fakeWebResearcher({
            scripts: [{ pages: [ABOUT_PAGE], calls: iungoCalls() }],
        })
        const classifier = fakeAi({
            answers: [{ organizations: [{ name: 'Acumen Capital Partners', is_lender: true, kind: 'lender' }] }],
        })
        const outcome = await researchFund({ fundManagerId: iungoId, researcher, classifier: classifier.provider, now })
        expect(outcome).toMatchObject({ status: 'done', findingsAdded: 5, findingsDropped: 2, fundsDiscovered: 1 })
        // The model is told at once when a claim won't be kept.
        expect(toolResults.filter(result => result.result.startsWith('Not recorded'))).toHaveLength(2)

        const { loadFundDetail } = await import('#server/utils/funds/fund-detail.ts')
        const fund = await loadFundDetail({ fundManagerId: iungoId })
        expect(fund.findings.map(finding => finding.field).sort()).toEqual(
            ['check_size', 'fund_raise', 'headquarters', 'loan_types', 'year_established'].sort(),
        )
        expect(
            fund.findings.every(finding => finding.sources[0]?.url === ABOUT_PAGE.url && finding.sources[0]?.quote),
        ).toBe(true)
        expect(fund.findings[0]!.sources[0]!.kind).toBe('news')
        expect(fund).toMatchObject({
            research_status: 'done',
            year_established: 2017,
            hq_country: 'KE',
            check_min_cents: 5_000_000,
            check_max_cents: 100_000_000,
            has_working_capital_loans: true,
            max_working_capital_loan_cents: 100_000_000,
            latest_fund_size_cents: 4_000_000_000,
            last_fund_close_on: '2025-01-01',
        })
        expect(fund.research_completeness).toBeGreaterThan(0)
    })

    it('keeps people and work history, but never an email the fund did not publish', async () => {
        const { loadFundDetail } = await import('#server/utils/funds/fund-detail.ts')
        const fund = await loadFundDetail({ fundManagerId: iungoId })
        expect(fund.people).toHaveLength(1)
        expect(fund.people[0]).toMatchObject({ name: 'Jane Mwangi', is_principal: true, email: null })
        expect(fund.people[0]!.affiliations.map(affiliation => affiliation.organization.name).sort()).toEqual([
            'Acumen Capital Partners',
            'Strathmore University',
        ])
    })

    it("pre-fills diligence from public sources but never over a person's answer", async () => {
        const { loadFundDetail } = await import('#server/utils/funds/fund-detail.ts')
        const fund = await loadFundDetail({ fundManagerId: iungoId })
        const byQuestion = Object.fromEntries(fund.diligence.map(item => [item.question, item]))
        expect(byQuestion.default_rate).toMatchObject({ answer: 'Under 3% (call with Jane)', source: 'manual' })
        expect(byQuestion.fx_risk).toMatchObject({
            answer: 'Lends in US dollars.',
            source: 'ai',
            source_urls: [ABOUT_PAGE.url],
        })
        expect(byQuestion.time_to_close).toMatchObject({ answer: null })
        expect(fund.diligence_completeness).toBe(40)
    })

    it('spiders to lenders from work history, skipping schools', async () => {
        const { listFundManagers } = await import('#server/database/fund-managers.ts')
        const funds = await listFundManagers({ limit: 1000 })
        const acumen = funds.find(fund => fund.name === 'Acumen Capital Partners')
        expect(acumen).toMatchObject({ origin: 'spider_person', discovered_from_id: iungoId })
        expect(funds.some(fund => fund.name === 'Strathmore University')).toBe(false)
        expect(queuedResearch).toContainEqual({ fundManagerId: acumen!.id, isPriority: false })
    })

    it('never records a rejected value again, and supersedes old values', async () => {
        const { listFundFindings, setFundFindingStatus } = await import('#server/database/fund-research.ts')
        const { researchFund } = await import('#server/utils/funds/research.ts')
        const headquarters = (await listFundFindings({ fundManagerId: iungoId })).find(
            finding => finding.field === 'headquarters',
        )!
        await setFundFindingStatus({ findingId: headquarters.id, status: 'rejected', userId, now })

        const movedPage = {
            ...ABOUT_PAGE,
            url: 'https://www.iungocapital.com/news/2026',
            text: 'Iungo Capital, founded in 2018, is headquartered in Nairobi, Kenya.',
        }
        const { researcher } = fakeWebResearcher({
            scripts: [
                {
                    pages: [movedPage],
                    calls: [
                        {
                            name: 'record_finding',
                            input: {
                                finding: { field: 'headquarters', value: { city: 'Nairobi', country: 'KE' } },
                                source_urls: [movedPage.url],
                                quote: 'is headquartered in Nairobi, Kenya',
                                confidence: 0.95,
                            },
                        },
                        {
                            name: 'record_finding',
                            input: {
                                finding: { field: 'year_established', value: { year: 2018 } },
                                source_urls: [movedPage.url],
                                quote: 'founded in 2018',
                                confidence: 0.95,
                            },
                        },
                    ],
                },
            ],
        })
        await researchFund({
            fundManagerId: iungoId,
            researcher,
            classifier: null,
            now: new Date('2026-10-18T00:00:00Z'),
        })
        const findings = await listFundFindings({ fundManagerId: iungoId, includeInactive: true })
        expect(findings.filter(finding => finding.field === 'headquarters').map(finding => finding.status)).toEqual([
            'rejected',
        ])
        expect(findings.filter(finding => finding.field === 'year_established').map(finding => finding.status)).toEqual(
            ['superseded', 'active'],
        )
        const { findFundManager } = await import('#server/database/fund-managers.ts')
        expect(await findFundManager({ fundManagerId: iungoId })).toMatchObject({
            year_established: 2018,
            hq_country: null,
        })
    })

    it('tells the next run what is already known and what is missing', async () => {
        const { researchFund } = await import('#server/utils/funds/research.ts')
        const { researcher, prompts } = fakeWebResearcher({ scripts: [{ pages: [], calls: [] }] })
        await researchFund({ fundManagerId: iungoId, researcher, classifier: null, now })
        expect(prompts[0]).toContain('Research this lender: Iungo Capital')
        expect(prompts[0]).toContain('Still missing')
        expect(prompts[0]).toContain('AUM')
        expect(prompts[0]).toContain('Jane Mwangi, Managing Partner')
    })
})

describe('Firecrawl', () => {
    it('uses pages read with a full browser and LinkedIn search snippets as evidence', async () => {
        const { addFund } = await import('#server/utils/funds/add-fund.ts')
        const { researchFund } = await import('#server/utils/funds/research.ts')
        const { loadFundDetail } = await import('#server/utils/funds/fund-detail.ts')
        const fund = (await addFund({ name: 'Enduring Planet', websiteUrl: null, origin: 'seed', now })).fund
        const readUrls: string[] = []
        const lookedUp: string[] = []
        const reader: WebReader = {
            name: 'fake-firecrawl',
            async readPage({ url }) {
                readUrls.push(url)
                if (url.includes('linkedin.com')) {
                    return {
                        page: null,
                        failure: { code: 'enrichment_not_enabled', message: 'Enrichment is not enabled' },
                        credits: 0,
                    }
                }
                return {
                    page: {
                        url,
                        title: 'Enduring Planet',
                        markdown:
                            'Enduring Planet provides revenue-based financing to climate small businesses. Founded in 2021.',
                        links: [],
                        statusCode: 200,
                    },
                    failure: null,
                    credits: 1,
                }
            },
            async lookupPerson({ linkedinUrl }) {
                lookedUp.push(linkedinUrl)
                return {
                    profile: {
                        provider: 'datalegion',
                        matchConfidence: 'high',
                        employment: [
                            {
                                organization: 'Enduring Planet',
                                website: 'enduringplanet.com',
                                title: 'CEO',
                                startDate: '2021-01',
                                endDate: null,
                            },
                            {
                                organization: 'Calvert Impact Capital',
                                website: 'calvertimpact.org',
                                title: 'Vice President',
                                startDate: '2015-06',
                                endDate: '2021-01',
                            },
                            {
                                organization: 'Bain & Company',
                                website: 'bain.com',
                                title: 'Consultant',
                                startDate: '2011',
                                endDate: '2015',
                            },
                        ],
                        education: [
                            {
                                organization: 'Stanford University',
                                website: 'stanford.edu',
                                title: 'MBA',
                                startDate: '2009',
                                endDate: '2011',
                            },
                        ],
                    },
                    failure: null,
                    credits: 10,
                }
            },
            async search() {
                return {
                    hits: [
                        {
                            url: 'https://www.linkedin.com/in/jane-founder',
                            title: 'Jane Founder - CEO at Enduring Planet - LinkedIn',
                            snippet:
                                'CEO Enduring Planet 2021 - Present. Previously Vice President at Calvert Impact Capital 2015 - 2021.',
                        },
                        {
                            url: 'https://ke.linkedin.com/in/sam-partner',
                            title: 'Partner Sam - Partner at Enduring Planet - LinkedIn',
                            snippet: 'Partner at Enduring Planet.',
                        },
                    ],
                    failure: null,
                    credits: 2,
                }
            },
        }
        const { researcher, toolResults, prompts } = fakeWebResearcher({
            scripts: [
                {
                    pages: [],
                    calls: [
                        { name: 'read_page', input: { url: 'https://www.enduringplanet.com/' } },
                        { name: 'read_page', input: { url: 'https://www.linkedin.com/in/jane-founder' } },
                        { name: 'search_web', input: { query: 'site:linkedin.com/in "Enduring Planet"', limit: null } },
                        {
                            name: 'record_finding',
                            input: {
                                finding: { field: 'year_established', value: { year: 2021 } },
                                source_urls: ['https://www.enduringplanet.com/'],
                                quote: 'Founded in 2021.',
                                confidence: 0.9,
                            },
                        },
                        {
                            name: 'record_person',
                            input: {
                                name: 'Jane Founder',
                                title: 'CEO',
                                is_principal: true,
                                linkedin_url: 'https://www.linkedin.com/in/jane-founder',
                                email: null,
                                bio_summary: null,
                                source_urls: ['https://www.linkedin.com/in/jane-founder'],
                                quote: 'Jane Founder - CEO at Enduring Planet',
                            },
                        },
                        {
                            name: 'record_person',
                            input: {
                                name: 'Sam Partner',
                                title: 'Partner',
                                is_principal: true,
                                linkedin_url: 'https://www.linkedin.com/in/sam-partner',
                                email: null,
                                bio_summary: null,
                                source_urls: ['https://www.linkedin.com/in/sam-partner'],
                                quote: 'Partner Sam - Partner at Enduring Planet',
                            },
                        },
                        {
                            name: 'record_affiliation',
                            input: {
                                person_name: 'Jane Founder',
                                organization_name: 'Calvert Impact Capital',
                                organization_kind: 'lender',
                                relation: 'employment',
                                title: 'Vice President',
                                start_year: 2015,
                                end_year: 2021,
                                source_urls: ['https://www.linkedin.com/in/jane-founder'],
                                quote: 'Previously Vice President at Calvert Impact Capital 2015 - 2021',
                            },
                        },
                    ],
                },
            ],
        })
        const outcome = await researchFund({ fundManagerId: fund.id, researcher, reader, classifier: null, now })
        // The team's LinkedIn search runs before the model starts, and its results are in the prompt.
        expect(prompts[0]).toContain('LinkedIn search results for this lender')
        expect(prompts[0]).toContain('Calvert Impact Capital')
        expect(outcome).toMatchObject({ status: 'done', findingsAdded: 1, findingsDropped: 0 })
        expect(
            toolResults.find(result => result.name === 'read_page' && result.result.includes('LinkedIn profiles')),
        ).toBeTruthy()

        const detail = await loadFundDetail({ fundManagerId: fund.id })
        expect(detail.year_established).toBe(2021)
        expect(detail.people[0]).toMatchObject({
            name: 'Jane Founder',
            linkedin_url: 'https://www.linkedin.com/in/jane-founder',
        })
        expect(detail.people[0]!.affiliations[0]).toMatchObject({
            organization: { name: 'Calvert Impact Capital' },
            start_year: 2015,
        })
        expect(detail.people[0]!.affiliations[0]!.sources[0]!.kind).toBe('linkedin')
        // Sam's work history came from the LinkedIn profile lookup (Jane already had hers from the snippet).
        expect(lookedUp).toEqual(['https://www.linkedin.com/in/sam-partner'])
        const sam = detail.people.find(person => person.name === 'Sam Partner')!
        expect(
            sam.affiliations.map(affiliation => `${affiliation.relation}:${affiliation.organization.name}`).sort(),
        ).toEqual(['education:Stanford University', 'employment:Bain & Company', 'employment:Calvert Impact Capital'])
        expect(sam.affiliations.find(affiliation => affiliation.organization.name === 'Bain & Company')).toMatchObject({
            start_year: 2011,
            end_year: 2015,
            sources: [{ url: 'https://www.linkedin.com/in/sam-partner', kind: 'linkedin' }],
        })
        expect(detail.runs[0]).toMatchObject({ firecrawl_credits: 17, web_fetches: 2, web_searches: 6 })
    })
})

describe('limits', () => {
    it('stops researching when the monthly budget is spent', async () => {
        const { writeFundResearchSettings, DEFAULT_FUND_RESEARCH_SETTINGS } =
            await import('#server/utils/funds/research-settings.ts')
        const { researchFund } = await import('#server/utils/funds/research.ts')
        await writeFundResearchSettings({ settings: { ...DEFAULT_FUND_RESEARCH_SETTINGS, monthly_budget_usd: 0.1 } })
        const { researcher, prompts } = fakeWebResearcher({ scripts: [] })
        const outcome = await researchFund({ fundManagerId: iungoId, researcher, classifier: null, now })
        expect(outcome).toEqual({ status: 'skipped', reason: 'Monthly research budget spent' })
        expect(prompts).toHaveLength(0)
        await writeFundResearchSettings({ settings: DEFAULT_FUND_RESEARCH_SETTINGS })
    })

    it('does not add funds past the limit, or anything the classifier says is not a lender', async () => {
        const { writeFundResearchSettings, DEFAULT_FUND_RESEARCH_SETTINGS } =
            await import('#server/utils/funds/research-settings.ts')
        const { discoverLenders } = await import('#server/utils/funds/spider.ts')
        const { countActiveFundManagers } = await import('#server/database/fund-managers.ts')
        const before = await countActiveFundManagers()
        const classifier = fakeAi({
            answers: [
                {
                    organizations: [
                        { name: 'Goldman Sachs', is_lender: false, kind: 'bank' },
                        { name: 'Sunfunder', is_lender: true, kind: 'lender' },
                        { name: 'Triodos Investment Management', is_lender: true, kind: 'lender' },
                    ],
                },
            ],
        })
        await writeFundResearchSettings({ settings: { ...DEFAULT_FUND_RESEARCH_SETTINGS, max_funds: before + 1 } })
        const added = await discoverLenders({
            candidates: ['Goldman Sachs', 'Sunfunder', 'Triodos Investment Management'].map(name => ({
                type: 'named' as const,
                name,
                website: null,
                context: 'test',
            })),
            discoveredFromId: iungoId,
            classifier: classifier.provider,
            now,
        })
        expect(added).toBe(1)
        expect(await countActiveFundManagers()).toBe(before + 1)

        // Already on the list: no model call, nothing added.
        const again = fakeAi({ answers: [] })
        expect(
            await discoverLenders({
                candidates: [{ type: 'named', name: 'Iungo Capital Ltd', website: null, context: 'test' }],
                discoveredFromId: null,
                classifier: again.provider,
                now,
            }),
        ).toBe(0)
        expect(again.prompts).toHaveLength(0)
        await writeFundResearchSettings({ settings: DEFAULT_FUND_RESEARCH_SETTINGS })
    })

    it('seeds the starting funds only once', async () => {
        const { ensureSeedFunds } = await import('#server/utils/funds/seed.ts')
        expect(await ensureSeedFunds({ now })).toBe(0)
    })
})

describe('cross-referencing public lists', () => {
    it('turns matching DFI records into sourced findings', async () => {
        const { upsertPublicInvestmentRecords } = await import('#server/database/public-investments.ts')
        const { matchPublicRecordsToFund } = await import('#server/utils/funds/public-records.ts')
        await upsertPublicInvestmentRecords({
            sourceKey: 'norfund',
            now,
            rows: [
                {
                    externalId: 'NF-1',
                    url: null,
                    recipientName: 'Iungo Capital Limited',
                    recipientNameKey: 'iungo capital',
                    amountCents: 300_000_000n,
                    currency: 'USD',
                    originalAmount: 3_000_000,
                    committedOn: new Date('2024-05-01T00:00:00Z'),
                    country: 'KE',
                    instrument: 'Loan',
                    description: 'Senior loan for SME asset finance',
                    isIntermediary: true,
                },
            ],
        })
        expect(
            await matchPublicRecordsToFund({
                fundManagerId: iungoId,
                nameKey: 'iungo capital',
                researchRunId: null,
                now,
            }),
        ).toBe(1)
        const { listFundFindings } = await import('#server/database/fund-research.ts')
        const record = (await listFundFindings({ fundManagerId: iungoId })).find(
            finding => finding.field === 'public_record',
        )!
        expect(record.value).toMatchObject({ source_label: 'Norfund', recipient: 'Iungo Capital Limited' })
        expect(record.sources[0]!.source).toMatchObject({
            url: 'https://www.norfund.no/investment-overview/',
            kind: 'dfi_database',
        })
        // Matching again doesn't duplicate it.
        await matchPublicRecordsToFund({ fundManagerId: iungoId, nameKey: 'iungo capital', researchRunId: null, now })
        expect(
            (await listFundFindings({ fundManagerId: iungoId })).filter(finding => finding.field === 'public_record'),
        ).toHaveLength(1)
    })
})
