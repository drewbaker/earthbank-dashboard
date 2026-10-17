// Covers the Firecrawl adapter: reading pages and searching, LinkedIn before enrichment is enabled,
// sites that return errors, and retrying when Firecrawl's per-minute limit is hit.
import { describe, expect, it } from 'vitest'
import { FirecrawlReader } from '#server/utils/web/firecrawl.ts'

/**
 * A fetch that returns canned responses in order and records each request.
 *
 * @param input.responses - Status and JSON body per call.
 * @returns The fetch and the requests it received.
 */
function fakeFetch({ responses }: { responses: { status: number; body: unknown }[] }) {
    const requests: { url: string; body: Record<string, unknown>; authorization: string | null }[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
        requests.push({
            url,
            body: JSON.parse(String(init.body)),
            authorization: new Headers(init.headers).get('authorization'),
        })
        const next = responses.shift()!
        return new Response(JSON.stringify(next.body), { status: next.status })
    }) as unknown as typeof fetch
    return { fetchImpl, requests }
}

/**
 * A reader with no request spacing or retry wait, for fast tests.
 *
 * @param input.fetchImpl - The fake fetch.
 * @returns The reader.
 */
function reader({ fetchImpl }: { fetchImpl: typeof fetch }) {
    return new FirecrawlReader({ apiKey: 'fc-test', requestsPerMinute: 60_000, retryDelayMs: 1, fetchImpl })
}

describe('FirecrawlReader.readPage', () => {
    it('returns the page markdown, links and credits', async () => {
        const { fetchImpl, requests } = fakeFetch({
            responses: [
                {
                    status: 200,
                    body: {
                        success: true,
                        data: {
                            markdown: '# Iungo Capital\nWe lend to SMEs.',
                            links: ['https://iungocapital.com/team'],
                            metadata: {
                                title: 'Iungo',
                                url: 'https://iungocapital.com/',
                                statusCode: 200,
                                creditsUsed: 1,
                            },
                        },
                    },
                },
            ],
        })
        const result = await reader({ fetchImpl }).readPage({ url: 'https://iungocapital.com' })
        expect(result).toEqual({
            page: {
                url: 'https://iungocapital.com/',
                title: 'Iungo',
                markdown: '# Iungo Capital\nWe lend to SMEs.',
                links: ['https://iungocapital.com/team'],
                statusCode: 200,
            },
            failure: null,
            credits: 1,
        })
        expect(requests[0]).toMatchObject({
            url: 'https://api.firecrawl.dev/v2/scrape',
            authorization: 'Bearer fc-test',
            body: { url: 'https://iungocapital.com', formats: ['markdown', 'links'] },
        })
    })

    it('reports LinkedIn as needing enrichment', async () => {
        const { fetchImpl } = fakeFetch({
            responses: [
                {
                    status: 403,
                    body: {
                        success: false,
                        code: 'THIRD_PARTY_DATA_ENRICHMENT_NOT_ENABLED',
                        error: 'Enrichment is not enabled',
                    },
                },
            ],
        })
        const result = await reader({ fetchImpl }).readPage({ url: 'https://www.linkedin.com/in/someone' })
        expect(result.page).toBeNull()
        expect(result.failure?.code).toBe('enrichment_not_enabled')
    })

    it('treats an error page from the site as not found, but still counts the credit', async () => {
        const { fetchImpl } = fakeFetch({
            responses: [
                {
                    status: 200,
                    body: {
                        success: true,
                        data: { markdown: 'Page not found', metadata: { statusCode: 404, creditsUsed: 1 } },
                    },
                },
            ],
        })
        const result = await reader({ fetchImpl }).readPage({ url: 'https://example.org/gone' })
        expect(result).toMatchObject({ page: null, failure: { code: 'not_found' }, credits: 1 })
    })

    it('waits and retries when rate limited', async () => {
        const { fetchImpl, requests } = fakeFetch({
            responses: [
                { status: 429, body: { success: false, error: 'Rate limit exceeded' } },
                {
                    status: 200,
                    body: { success: true, data: { markdown: 'ok', metadata: { statusCode: 200, creditsUsed: 1 } } },
                },
            ],
        })
        const result = await reader({ fetchImpl }).readPage({ url: 'https://example.org' })
        expect(requests).toHaveLength(2)
        expect(result.page?.markdown).toBe('ok')
    })
})

describe('FirecrawlReader.search', () => {
    it('returns results with snippets and the credits used', async () => {
        const { fetchImpl, requests } = fakeFetch({
            responses: [
                {
                    status: 200,
                    body: {
                        success: true,
                        creditsUsed: 2,
                        data: {
                            web: [
                                {
                                    url: 'https://www.linkedin.com/in/roelanddonckers',
                                    title: 'Roeland Donckers - Managing Partner at iungo capital - LinkedIn',
                                    description: 'Managing Partner at iungo capital',
                                },
                            ],
                        },
                    },
                },
            ],
        })
        const result = await reader({ fetchImpl }).search({ query: 'site:linkedin.com/in "Iungo Capital"', limit: 50 })
        expect(result.hits).toEqual([
            {
                url: 'https://www.linkedin.com/in/roelanddonckers',
                title: 'Roeland Donckers - Managing Partner at iungo capital - LinkedIn',
                snippet: 'Managing Partner at iungo capital',
            },
        ])
        expect(result.credits).toBe(2)
        expect(requests[0]!.body).toMatchObject({ limit: 20 })
    })
})

describe('FirecrawlReader.lookupPerson', () => {
    it("reads Data Legion's work history and education", async () => {
        const { fetchImpl, requests } = fakeFetch({
            responses: [
                {
                    status: 200,
                    body: {
                        success: true,
                        data: {
                            creditsCost: 10,
                            alexandria: [
                                {
                                    data: {
                                        matches: [
                                            {
                                                person: {
                                                    experience: [
                                                        {
                                                            title: {
                                                                cleaned: 'managing partner',
                                                                raw: ['Managing Partner'],
                                                            },
                                                            organization: {
                                                                name: { cleaned: 'iungo capital' },
                                                                website: 'iungocapital.com',
                                                            },
                                                            start_date: '2016-01',
                                                            end_date: null,
                                                        },
                                                    ],
                                                    education: [
                                                        {
                                                            degree: { cleaned: 'msc' },
                                                            organization: { name: { raw: ['KU Leuven'] } },
                                                            start_date: '1995',
                                                            end_date: '2000',
                                                        },
                                                    ],
                                                },
                                                match_metadata: { match_confidence: 'high' },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        })
        const result = await reader({ fetchImpl }).lookupPerson({
            linkedinUrl: 'https://www.linkedin.com/in/roelanddonckers',
        })
        expect(result.credits).toBe(10)
        expect(result.profile).toEqual({
            provider: 'datalegion',
            matchConfidence: 'high',
            employment: [
                {
                    organization: 'iungo capital',
                    website: 'iungocapital.com',
                    title: 'Managing Partner',
                    startDate: '2016-01',
                    endDate: null,
                },
            ],
            education: [{ organization: 'KU Leuven', website: null, title: 'msc', startDate: '1995', endDate: '2000' }],
        })
        expect(requests[0]!.body).toMatchObject({
            alexandria: {
                provider: 'datalegion',
                capability: 'people/enrich-base-no-contact',
                options: { social_url: 'https://www.linkedin.com/in/roelanddonckers' },
            },
        })
    })

    it('reports no match', async () => {
        const { fetchImpl } = fakeFetch({
            responses: [
                {
                    status: 200,
                    body: { success: true, data: { creditsCost: 1, alexandria: [{ data: { matches: [] } }] } },
                },
            ],
        })
        const result = await reader({ fetchImpl }).lookupPerson({ linkedinUrl: 'https://www.linkedin.com/in/nobody' })
        expect(result).toMatchObject({ profile: null, failure: { code: 'no_match' }, credits: 1 })
    })
})
