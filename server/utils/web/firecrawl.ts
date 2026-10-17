import { z } from 'zod'
import { config } from '#server/utils/config.ts'
import type {
    PersonProfile,
    ProfileEntry,
    ReadFailure,
    ReadPage,
    WebReader,
    WebSearchHit,
} from '#server/utils/web/types.ts'

const FIRECRAWL_API = 'https://api.firecrawl.dev/v2'
const MAX_ATTEMPTS = 4
const REQUEST_TIMEOUT_MS = 90_000

// Firecrawl limits requests per minute by plan (10 on the smallest). Calls from this process are spaced
// out to stay under FIRECRAWL_REQUESTS_PER_MINUTE; a 429 still waits and retries.
let nextRequestAt = 0

// Only the fields we use are validated; the rest of Firecrawl's payload is ignored.
const ScrapePayload = z.object({
    success: z.boolean(),
    code: z.string().nullish(),
    error: z.string().nullish(),
    data: z
        .object({
            markdown: z.string().nullish(),
            links: z.array(z.string()).nullish(),
            metadata: z
                .object({
                    title: z.union([z.string(), z.array(z.string())]).nullish(),
                    url: z.string().nullish(),
                    sourceURL: z.string().nullish(),
                    statusCode: z.number().nullish(),
                    creditsUsed: z.number().nullish(),
                })
                .nullish(),
        })
        .nullish(),
})

const SearchPayload = z.object({
    success: z.boolean(),
    code: z.string().nullish(),
    error: z.string().nullish(),
    creditsUsed: z.number().nullish(),
    data: z
        .object({
            web: z
                .array(z.object({ url: z.string(), title: z.string().nullish(), description: z.string().nullish() }))
                .nullish(),
        })
        .nullish(),
})

// Data Legion's profile-only person lookup in Firecrawl's Alexandria catalog: work history and education
// from a LinkedIn URL, without contact details (cheaper, and no personal data we don't need).
const PERSON_LOOKUP = { provider: 'datalegion', capability: 'people/enrich-base-no-contact' } as const

const CleanedText = z.object({ cleaned: z.string().nullish(), raw: z.array(z.string()).nullish() }).nullish()
const ProfileOrganization = z.object({ name: CleanedText, website: z.string().nullish() }).nullish()
const LookupPayload = z.object({
    success: z.boolean(),
    code: z.string().nullish(),
    error: z.string().nullish(),
    data: z
        .object({
            creditsCost: z.number().nullish(),
            alexandria: z
                .array(
                    z.object({
                        error: z.object({ code: z.string().nullish(), message: z.string().nullish() }).nullish(),
                        data: z
                            .object({
                                matches: z
                                    .array(
                                        z.object({
                                            person: z.object({
                                                experience: z
                                                    .array(
                                                        z.object({
                                                            title: CleanedText,
                                                            organization: ProfileOrganization,
                                                            start_date: z.string().nullish(),
                                                            end_date: z.string().nullish(),
                                                        }),
                                                    )
                                                    .nullish(),
                                                education: z
                                                    .array(
                                                        z.object({
                                                            degree: CleanedText,
                                                            organization: ProfileOrganization,
                                                            start_date: z.string().nullish(),
                                                            end_date: z.string().nullish(),
                                                        }),
                                                    )
                                                    .nullish(),
                                            }),
                                            match_metadata: z
                                                .object({ match_confidence: z.string().nullish() })
                                                .nullish(),
                                        }),
                                    )
                                    .nullish(),
                            })
                            .nullish(),
                    }),
                )
                .nullish(),
        })
        .nullish(),
})

/**
 * Firecrawl (firecrawl.dev): renders JavaScript, gets past most bot blocking, and searches the web.
 *
 * Runs wherever the app runs (Render included): plain HTTPS calls to Firecrawl's API with
 * FIRECRAWL_API_KEY. LinkedIn profiles need Firecrawl's "enrichment" turned on for the team; until
 * then reading one returns `enrichment_not_enabled`, and LinkedIn data comes from search snippets.
 */
export class FirecrawlReader implements WebReader {
    readonly name = 'firecrawl'
    private readonly apiKey: string
    private readonly fetchImpl: typeof fetch
    private readonly minIntervalMs: number
    private readonly retryDelayMs: number

    /**
     * @param input.apiKey - Firecrawl API key.
     * @param input.requestsPerMinute - Most requests per minute from this process.
     * @param input.retryDelayMs - Wait before retrying a rate-limited or failed request (doubles each time).
     * @param input.fetchImpl - fetch to use (tests).
     */
    constructor({
        apiKey,
        requestsPerMinute = 10,
        retryDelayMs = 15_000,
        fetchImpl = fetch,
    }: {
        apiKey: string
        requestsPerMinute?: number
        retryDelayMs?: number
        fetchImpl?: typeof fetch
    }) {
        this.apiKey = apiKey
        this.fetchImpl = fetchImpl
        this.minIntervalMs = Math.ceil(60_000 / Math.max(requestsPerMinute, 1))
        this.retryDelayMs = retryDelayMs
    }

    /**
     * Read one page as markdown, with its links.
     *
     * @param input.url - The page.
     * @param input.waitForMs - Extra time for JavaScript to render (default 0; Firecrawl waits for load anyway).
     * @returns The page, or why it couldn't be read, and the credits used.
     */
    async readPage({ url, waitForMs = 0 }: { url: string; waitForMs?: number }) {
        const response = await this.post({
            path: '/scrape',
            body: {
                url,
                formats: ['markdown', 'links'],
                onlyMainContent: true,
                waitFor: waitForMs,
                proxy: 'auto',
                timeout: 60_000,
            },
        })
        const payload = ScrapePayload.safeParse(response.json)
        if (!payload.success || !payload.data.success || !payload.data.data) {
            return {
                page: null,
                failure: failureFrom({ status: response.status, code: payload.data?.code, error: payload.data?.error }),
                credits: 0,
            }
        }
        const data = payload.data.data
        const metadata = data.metadata ?? {}
        const credits = metadata.creditsUsed ?? 1
        const statusCode = metadata.statusCode ?? null
        if (statusCode !== null && statusCode >= 400) {
            return {
                page: null,
                failure: failureFrom({ status: statusCode, code: null, error: `The site returned HTTP ${statusCode}` }),
                credits,
            }
        }
        const page: ReadPage = {
            url: metadata.url ?? metadata.sourceURL ?? url,
            title: Array.isArray(metadata.title) ? (metadata.title[0] ?? null) : (metadata.title ?? null),
            markdown: data.markdown ?? '',
            links: data.links ?? [],
            statusCode,
        }
        return { page, failure: null, credits }
    }

    /**
     * Search the web.
     *
     * @param input.query - Search query (operators like `site:linkedin.com/in` work).
     * @param input.limit - Most results (1–20).
     * @returns Results with snippets, or why the search failed, and the credits used.
     */
    async search({ query, limit }: { query: string; limit: number }) {
        const response = await this.post({
            path: '/search',
            body: { query: query.slice(0, 500), limit: Math.min(Math.max(limit, 1), 20) },
        })
        const payload = SearchPayload.safeParse(response.json)
        if (!payload.success || !payload.data.success) {
            return {
                hits: [],
                failure: failureFrom({ status: response.status, code: payload.data?.code, error: payload.data?.error }),
                credits: 0,
            }
        }
        const hits: WebSearchHit[] = (payload.data.data?.web ?? []).map(result => ({
            url: result.url,
            title: result.title ?? null,
            snippet: result.description ?? null,
        }))
        return { hits, failure: null, credits: payload.data.creditsUsed ?? Math.ceil(hits.length / 10) * 2 }
    }

    /**
     * Look up a person's work history and education from their LinkedIn URL (Data Legion, through
     * Firecrawl's Alexandria catalog; the provider must be enabled for the Firecrawl team).
     *
     * @param input.linkedinUrl - The person's LinkedIn profile URL.
     * @returns The profile, or why there isn't one, and the credits used.
     */
    async lookupPerson({ linkedinUrl }: { linkedinUrl: string }) {
        const response = await this.post({
            path: '/scrape',
            body: { alexandria: { ...PERSON_LOOKUP, options: { social_url: linkedinUrl, titlecase: true } } },
        })
        const payload = LookupPayload.safeParse(response.json)
        if (!payload.success || !payload.data.success) {
            return {
                profile: null,
                failure: failureFrom({ status: response.status, code: payload.data?.code, error: payload.data?.error }),
                credits: 0,
            }
        }
        const credits = payload.data.data?.creditsCost ?? 0
        const call = payload.data.data?.alexandria?.[0]
        if (call?.error) {
            return {
                profile: null,
                failure: failureFrom({ status: 400, code: call.error.code, error: call.error.message }),
                credits,
            }
        }
        const match = call?.data?.matches?.[0]
        if (!match) {
            return { profile: null, failure: { code: 'no_match' as const, message: 'No profile found' }, credits }
        }
        const profile: PersonProfile = {
            provider: PERSON_LOOKUP.provider,
            matchConfidence: match.match_metadata?.match_confidence ?? null,
            employment: (match.person.experience ?? []).flatMap(entry =>
                profileEntry({
                    organization: entry.organization,
                    title: textOf({ value: entry.title }),
                    startDate: entry.start_date,
                    endDate: entry.end_date,
                }),
            ),
            education: (match.person.education ?? []).flatMap(entry =>
                profileEntry({
                    organization: entry.organization,
                    title: textOf({ value: entry.degree }),
                    startDate: entry.start_date,
                    endDate: entry.end_date,
                }),
            ),
        }
        return { profile, failure: null, credits }
    }

    /**
     * POST to Firecrawl, retrying rate limits and server errors with backoff.
     *
     * @param input.path - API path, e.g. `/scrape`.
     * @param input.body - JSON body.
     * @returns The HTTP status and parsed JSON (null when the body wasn't JSON).
     */
    private async post({ path, body }: { path: string; body: Record<string, unknown> }) {
        let lastStatus = 0
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            await this.waitForTurn()
            try {
                const response = await this.fetchImpl(`${FIRECRAWL_API}${path}`, {
                    method: 'POST',
                    headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                })
                lastStatus = response.status
                const json: unknown = await response.json().catch(() => null)
                if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
                    await delay({ ms: this.retryDelayMs * 2 ** (attempt - 1) })
                    continue
                }
                return { status: response.status, json }
            } catch (error) {
                if (attempt === MAX_ATTEMPTS) {
                    return {
                        status: lastStatus,
                        json: { success: false, error: error instanceof Error ? error.message : String(error) },
                    }
                }
                await delay({ ms: this.retryDelayMs * 2 ** (attempt - 1) })
            }
        }
        return { status: lastStatus, json: null }
    }

    /**
     * Wait until this process may send its next request (spacing requests under the per-minute limit).
     *
     * @returns Resolves when it's this call's turn.
     */
    private async waitForTurn() {
        const now = Date.now()
        const startAt = Math.max(now, nextRequestAt)
        nextRequestAt = startAt + this.minIntervalMs
        if (startAt > now) {
            await delay({ ms: startAt - now })
        }
    }
}

/**
 * The configured web reader, or null when FIRECRAWL_API_KEY isn't set (research then uses only
 * Anthropic's web search and fetch).
 *
 * @returns The reader, or null.
 */
export function webReader(): WebReader | null {
    return config.firecrawlApiKey
        ? new FirecrawlReader({ apiKey: config.firecrawlApiKey, requestsPerMinute: config.firecrawlRequestsPerMinute })
        : null
}

/**
 * What vendor credits cost, in millionths of a dollar.
 *
 * @param input.credits - Firecrawl credits.
 * @returns Micro-dollars.
 */
export function webReaderCostMicroUsd({ credits }: { credits: number }) {
    return Math.round(credits * config.firecrawlUsdPerCredit * 1_000_000)
}

/**
 * The display text of a provider field (raw when given, else the cleaned form).
 *
 * @param input.value - `{ cleaned, raw }`.
 * @returns The text, or null.
 */
function textOf({ value }: { value: { cleaned?: string | null; raw?: string[] | null } | null | undefined }) {
    return value?.raw?.[0] ?? value?.cleaned ?? null
}

/**
 * One profile entry, or nothing when it has no organization name.
 *
 * @param input.organization - The provider's organization object.
 * @param input.title - Job title or degree.
 * @param input.startDate - Start, as given.
 * @param input.endDate - End, as given.
 * @returns A one-item array, or an empty one.
 */
function profileEntry({
    organization,
    title,
    startDate,
    endDate,
}: {
    organization:
        { name?: { cleaned?: string | null; raw?: string[] | null } | null; website?: string | null } | null | undefined
    title: string | null
    startDate: string | null | undefined
    endDate: string | null | undefined
}): ProfileEntry[] {
    const name = textOf({ value: organization?.name })
    return name
        ? [
              {
                  organization: name,
                  website: organization?.website ?? null,
                  title,
                  startDate: startDate ?? null,
                  endDate: endDate ?? null,
              },
          ]
        : []
}

/**
 * Turn a Firecrawl error into a short, typed reason.
 *
 * @param input.status - HTTP status.
 * @param input.code - Firecrawl's error code, if any.
 * @param input.error - Firecrawl's message, if any.
 * @returns The failure.
 */
function failureFrom({
    status,
    code,
    error,
}: {
    status: number
    code: string | null | undefined
    error: string | null | undefined
}): ReadFailure {
    const message = (error ?? `Firecrawl returned HTTP ${status}`).slice(0, 300)
    if (code === 'THIRD_PARTY_DATA_ENRICHMENT_NOT_ENABLED') {
        return { code: 'enrichment_not_enabled', message }
    }
    if (status === 402) {
        return { code: 'out_of_credits', message }
    }
    if (status === 429) {
        return { code: 'rate_limited', message }
    }
    if (status === 404) {
        return { code: 'not_found', message }
    }
    if (status === 403) {
        return { code: 'blocked', message }
    }
    return { code: 'failed', message }
}

/**
 * Wait.
 *
 * @param input.ms - Milliseconds.
 * @returns Resolves after the wait.
 */
function delay({ ms }: { ms: number }) {
    return new Promise(resolve => setTimeout(resolve, ms))
}
