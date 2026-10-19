import { createHash } from 'node:crypto'
import readXlsxFile from 'read-excel-file/node'
import { z } from 'zod'
import { listFundIdentities } from '#server/database/fund-managers.ts'
import { createFundResearchRun, finishFundResearchRun } from '#server/database/fund-research.ts'
import type { PublicInvestmentRow } from '#server/database/public-investments.ts'
import {
    findPublicInvestmentSourceState,
    listUnmatchedIntermediaries,
    savePublicInvestmentSourceState,
    upsertPublicInvestmentRecords,
} from '#server/database/public-investments.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { EXTRACT_PUBLIC_INVESTMENTS_INSTRUCTIONS } from '#server/utils/ai/instructions.ts'
import { researchCostMicroUsd } from '#server/utils/ai/web-research.ts'
import type { PublicInvestmentSourceDefinition } from '#server/utils/funds/public-investment-sources.ts'
import { findPublicInvestmentSource } from '#server/utils/funds/public-investment-sources.ts'
import { matchPublicRecordsToFund } from '#server/utils/funds/public-records.ts'
import { refreshFundResearchValues } from '#server/utils/funds/refresh-values.ts'
import { readFundResearchSettings, readMonthResearchSpend } from '#server/utils/funds/research-settings.ts'
import { discoverLenders } from '#server/utils/funds/spider.ts'
import { partialDateStart } from '#server/utils/funds/verify-finding.ts'
import { spreadsheetText } from '#server/utils/knowledge/extract.ts'
import { safeFetch } from '#server/utils/safe-fetch.ts'
import { webReaderCostMicroUsd } from '#server/utils/web/firecrawl.ts'
import type { WebReader } from '#server/utils/web/types.ts'
import { COUNTRY_CODES } from '#shared/constants/regions.ts'
import { toUsdCents } from '#shared/funds/money.ts'
import { organizationNameKey } from '#shared/funds/organization-names.ts'

// Pages (or spreadsheet chunks, or API pages) read per sync; long lists continue next run.
const MAX_PAGES_PER_RUN = 15
const SPREADSHEET_ROWS_PER_CHUNK = 60
const MAX_PAGE_TEXT = 60_000
const SPIDER_CANDIDATES_PER_RUN = 50
const USASPENDING_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/'
const COUNTRIES = new Set(COUNTRY_CODES)

export const ExtractedInvestmentPage = z.object({
    rows: z.array(
        z.object({
            recipient_name: z.string(),
            external_id: z.string().nullable(),
            url: z.string().nullable(),
            amount: z.number().nullable(),
            currency: z.string().nullable(),
            committed_on: z.string().nullable(),
            country: z.string().nullable(),
            instrument: z.string().nullable(),
            description: z.string().nullable(),
            is_intermediary: z.boolean(),
        }),
    ),
    next_page_url: z.string().nullable(),
})
export type ExtractedInvestmentPage = z.infer<typeof ExtractedInvestmentPage>

/** One page of rows from any adapter, and where to resume. */
type AdapterPage = { rows: PublicInvestmentRow[]; nextCursor: string | null; costMicroUsd: number }

/**
 * Read the next stretch of one public list, store its rows, cross-reference funds and spider from
 * the lenders on it.
 *
 * Reads at most MAX_PAGES_PER_RUN pages and remembers where it stopped, so a long list is covered
 * over several weekly runs. Stops early when this month's research budget is spent.
 *
 * @param input.sourceKey - The list's key.
 * @param input.ai - Model for reading list pages and classifying lenders.
 * @param input.reader - Firecrawl, which renders JavaScript and gets past bot blocking; null reads pages
 *   with a plain request.
 * @param input.now - Current time.
 * @returns Counts, or a skip note.
 */
export async function syncPublicInvestmentSource({
    sourceKey,
    ai,
    reader = null,
    now,
}: {
    sourceKey: string
    ai: AiProvider
    reader?: WebReader | null
    now: Date
}) {
    const source = findPublicInvestmentSource({ key: sourceKey })
    if (!source) {
        return { skipped: `Unknown list ${sourceKey}` }
    }
    const settings = await readFundResearchSettings()
    if ((await readMonthResearchSpend({ settings, now })).isOverBudget) {
        return { skipped: 'Monthly research budget spent' }
    }
    const state = await findPublicInvestmentSourceState({ key: sourceKey })
    await savePublicInvestmentSourceState({ key: sourceKey, data: { status: 'running', last_error: null } })
    const run = await createFundResearchRun({ kind: 'public_list', sourceKey, model: ai.model, now })
    let cursor = state?.cursor ?? null
    let created = 0
    let costMicroUsd = 0
    let pages = 0
    try {
        do {
            const page = await readAdapterPage({ source, cursor, ai, reader })
            costMicroUsd += page.costMicroUsd
            created += await upsertPublicInvestmentRecords({ sourceKey, rows: page.rows, now })
            cursor = page.nextCursor
            pages += 1
        } while (cursor && pages < MAX_PAGES_PER_RUN)

        await crossReferenceFunds({ now })
        const candidates =
            source.feedsSpider === false
                ? []
                : await listUnmatchedIntermediaries({ sourceKey, limit: SPIDER_CANDIDATES_PER_RUN })
        const discovered = await discoverLenders({
            candidates: candidates.map(candidate => ({
                type: 'public_record' as const,
                name: candidate.recipient_name,
                context: `a recipient on ${source.label}'s list${candidate.description ? ` (${candidate.description.slice(0, 120)})` : ''}`,
            })),
            discoveredFromId: null,
            classifier: ai,
            now,
        })
        await savePublicInvestmentSourceState({
            key: sourceKey,
            data: { status: 'idle', cursor, last_synced_at: new Date() },
        })
        await finishFundResearchRun({
            researchRunId: run.id,
            data: {
                status: 'done',
                finished_at: new Date(),
                cost_micro_usd: costMicroUsd,
                funds_discovered: discovered,
            },
        })
        return { pages, created, discovered, isComplete: cursor === null }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[research] public list sync failed', sourceKey, error)
        await savePublicInvestmentSourceState({
            key: sourceKey,
            data: { status: 'error', cursor, last_error: message.slice(0, 500) },
        })
        await finishFundResearchRun({
            researchRunId: run.id,
            data: {
                status: 'failed',
                finished_at: new Date(),
                cost_micro_usd: costMicroUsd,
                error: message.slice(0, 500),
            },
        })
        return { failed: message, pages, created }
    }
}

/**
 * Turn HTML into readable text, keeping links as "text (url)" so the AI can find detail and next-page links.
 *
 * @param input.html - The page HTML.
 * @param input.baseUrl - The page URL, to make links absolute.
 * @returns Plain text.
 */
export function htmlToText({ html, baseUrl }: { html: string; baseUrl: string }) {
    return html
        .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, text: string) => {
            try {
                return ` ${text} (${new URL(href, baseUrl).toString()}) `
            } catch {
                return ` ${text} `
            }
        })
        .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim()
}

/**
 * Shape rows the AI extracted into storable records (dropping anything unusable).
 *
 * @param input.extracted - The AI's rows.
 * @param input.pageUrl - The page they came from (fallback link and id seed).
 * @returns Rows ready to store.
 */
export function rowsFromExtraction({
    extracted,
    pageUrl,
}: {
    extracted: ExtractedInvestmentPage['rows']
    pageUrl: string
}) {
    return extracted.flatMap(row => {
        const recipientName = row.recipient_name.trim()
        const recipientNameKey = organizationNameKey({ name: recipientName })
        if (!recipientNameKey) {
            return []
        }
        const currency = row.currency?.trim().toUpperCase() || null
        const amount = row.amount !== null && row.amount > 0 ? row.amount : null
        const cents = amount !== null && currency ? toUsdCents({ amount, currency }) : null
        const country = row.country?.trim().toUpperCase() ?? null
        const url = row.url && /^https?:\/\//.test(row.url) ? row.url : null
        return [
            {
                externalId:
                    row.external_id?.trim() ||
                    url ||
                    createHash('sha256')
                        .update(`${recipientNameKey}|${row.committed_on ?? ''}|${amount ?? ''}|${pageUrl}`)
                        .digest('hex')
                        .slice(0, 32),
                url: url ?? pageUrl,
                recipientName,
                recipientNameKey,
                amountCents: cents === null ? null : BigInt(cents),
                currency,
                originalAmount: amount,
                committedOn: partialDateStart({ text: row.committed_on }),
                country: country && COUNTRIES.has(country) ? country : null,
                instrument: row.instrument?.trim() || null,
                description: row.description?.trim().slice(0, 500) || null,
                isIntermediary: row.is_intermediary,
            } satisfies PublicInvestmentRow,
        ]
    })
}

/**
 * Read one page from a list with its adapter.
 *
 * @param input.source - The list definition.
 * @param input.cursor - Where to resume (null starts over).
 * @param input.ai - Model for AI extraction.
 * @param input.reader - Firecrawl, or null for plain requests.
 * @returns Rows, the next cursor and what the page cost.
 */
async function readAdapterPage({
    source,
    cursor,
    ai,
    reader,
}: {
    source: PublicInvestmentSourceDefinition
    cursor: string | null
    ai: AiProvider
    reader: WebReader | null
}): Promise<AdapterPage> {
    const { adapter } = source
    if (adapter.type === 'usaspending') {
        return readUsaspendingPage({ filters: adapter.filters, page: Number(cursor ?? 1) })
    }
    if (adapter.type === 'spreadsheet_link') {
        return readSpreadsheetChunk({ source, pageUrl: adapter.pageUrl, chunk: Number(cursor ?? 0), ai, reader })
    }
    return readHtmlPage({ source, pageUrl: cursor ?? adapter.startUrl, startUrl: adapter.startUrl, ai, reader })
}

/**
 * Read one HTML list page with the AI.
 *
 * @param input.source - The list definition.
 * @param input.pageUrl - The page to read.
 * @param input.startUrl - The list's first page (next pages must stay on its host).
 * @param input.ai - Model.
 * @param input.reader - Firecrawl, or null for plain requests.
 * @returns Rows, the next page URL and the cost.
 */
async function readHtmlPage({
    source,
    pageUrl,
    startUrl,
    ai,
    reader,
}: {
    source: PublicInvestmentSourceDefinition
    pageUrl: string
    startUrl: string
    ai: AiProvider
    reader: WebReader | null
}): Promise<AdapterPage> {
    const page = await readListPage({ label: source.label, url: pageUrl, reader })
    const extracted = await extractRows({
        ai,
        label: source.label,
        text: page.text.slice(0, MAX_PAGE_TEXT),
        pageUrl: page.url,
    })
    const next = extracted.output?.next_page_url ?? null
    const isSameSite = next !== null && safeHost({ url: next }) === safeHost({ url: startUrl }) && next !== pageUrl
    return {
        rows: rowsFromExtraction({ extracted: extracted.output?.rows ?? [], pageUrl: page.url }),
        nextCursor: isSameSite ? next : null,
        costMicroUsd: extracted.costMicroUsd + page.costMicroUsd,
    }
}

/**
 * Get a list page's text and links: through Firecrawl when it's configured (it renders JavaScript and
 * gets past most bot blocking), falling back to a plain request; a plain request otherwise.
 *
 * @param input.label - The institution, for error messages.
 * @param input.url - The page.
 * @param input.reader - Firecrawl, or null.
 * @returns The page text (markdown or plain text, links kept), its links, final URL and cost.
 * @throws Error when the page can't be read either way.
 */
async function readListPage({ label, url, reader }: { label: string; url: string; reader: WebReader | null }) {
    let costMicroUsd = 0
    let firecrawlError: string | null = null
    if (reader) {
        const { page, failure, credits } = await reader.readPage({ url, waitForMs: 3000 })
        costMicroUsd += webReaderCostMicroUsd({ credits })
        if (page && page.markdown.trim()) {
            return { text: page.markdown, url: page.url, links: page.links, costMicroUsd }
        }
        firecrawlError = failure?.message ?? 'empty page'
    }
    const response = await safeFetch({ url })
    if (response.status >= 400) {
        throw new Error(
            `${label} returned HTTP ${response.status}${firecrawlError ? ` (Firecrawl: ${firecrawlError})` : ''}`,
        )
    }
    const html = response.body.toString('utf8')
    const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].flatMap(match => {
        try {
            return [new URL(match[1]!, response.url).toString()]
        } catch {
            return []
        }
    })
    return { text: htmlToText({ html, baseUrl: response.url }), url: response.url, links, costMicroUsd }
}

/**
 * Read one chunk of a list published as a spreadsheet linked from a landing page.
 *
 * @param input.source - The list definition.
 * @param input.pageUrl - The landing page with the download link.
 * @param input.chunk - Which chunk of rows (0-based).
 * @param input.ai - Model.
 * @param input.reader - Firecrawl, or null for plain requests.
 * @returns Rows, the next chunk number and the cost.
 */
async function readSpreadsheetChunk({
    source,
    pageUrl,
    chunk,
    ai,
    reader,
}: {
    source: PublicInvestmentSourceDefinition
    pageUrl: string
    chunk: number
    ai: AiProvider
    reader: WebReader | null
}): Promise<AdapterPage> {
    const landing = await readListPage({ label: source.label, url: pageUrl, reader })
    const links = landing.links.filter(link => /\.(xlsx|csv)(\?|$)/i.test(link))
    if (links.length === 0) {
        throw new Error(`No spreadsheet link found on ${pageUrl}`)
    }
    // The newest file sorts last by its dated path (…/uploads/2026/10/…).
    const fileUrl = links.sort().at(-1)!
    const file = await safeFetch({ url: fileUrl })
    const lines = fileUrl.toLowerCase().includes('.csv')
        ? file.body.toString('utf8').split(/\r?\n/)
        : spreadsheetText({ sheets: await readXlsxFile(file.body) }).split('\n')
    const header = lines.slice(0, 3).join('\n')
    const start = 3 + chunk * SPREADSHEET_ROWS_PER_CHUNK
    const body = lines.slice(start, start + SPREADSHEET_ROWS_PER_CHUNK)
    if (body.length === 0) {
        return { rows: [], nextCursor: null, costMicroUsd: landing.costMicroUsd }
    }
    const extracted = await extractRows({
        ai,
        label: source.label,
        text: `${header}\n${body.join('\n')}`,
        pageUrl: fileUrl,
    })
    return {
        rows: rowsFromExtraction({ extracted: extracted.output?.rows ?? [], pageUrl: source.url }),
        nextCursor: start + SPREADSHEET_ROWS_PER_CHUNK < lines.length ? String(chunk + 1) : null,
        costMicroUsd: extracted.costMicroUsd + landing.costMicroUsd,
    }
}

/**
 * Read one page of US federal awards from USAspending.gov.
 *
 * @param input.filters - USAspending award filters.
 * @param input.page - Page number (1-based).
 * @returns Rows, the next page and zero cost.
 */
async function readUsaspendingPage({
    filters,
    page,
}: {
    filters: Record<string, unknown>
    page: number
}): Promise<AdapterPage> {
    const response = await safeFetch({
        url: USASPENDING_URL,
        init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                filters: {
                    time_period: [{ start_date: '2015-10-01', end_date: new Date().toISOString().slice(0, 10) }],
                    ...filters,
                },
                fields: [
                    'Award ID',
                    'Recipient Name',
                    'Award Amount',
                    'Start Date',
                    'Description',
                    'generated_internal_id',
                ],
                page,
                limit: 100,
                sort: 'Award Amount',
                order: 'desc',
            }),
        },
    })
    if (response.status >= 400) {
        throw new Error(`USAspending returned HTTP ${response.status}`)
    }
    return { ...usaspendingRows({ payload: JSON.parse(response.body.toString('utf8')), page }), costMicroUsd: 0 }
}

/**
 * Map a USAspending search response to rows (every recipient of these programs is a lender).
 *
 * @param input.payload - The parsed response.
 * @param input.page - The page number read.
 * @returns Rows and the next page cursor.
 */
export function usaspendingRows({ payload, page }: { payload: unknown; page: number }) {
    const parsed = z
        .object({
            results: z.array(z.record(z.string(), z.unknown())),
            page_metadata: z.object({ hasNext: z.boolean() }).partial().optional(),
        })
        .parse(payload)
    const rows = parsed.results.flatMap(result => {
        const recipientName = String(result['Recipient Name'] ?? '').trim()
        const recipientNameKey = organizationNameKey({ name: recipientName })
        const awardId = String(result['Award ID'] ?? result.generated_internal_id ?? '')
        if (!recipientNameKey || !awardId) {
            return []
        }
        const amount = Number(result['Award Amount'])
        const internalId = result.generated_internal_id ? String(result.generated_internal_id) : null
        return [
            {
                externalId: awardId,
                url: internalId ? `https://www.usaspending.gov/award/${internalId}` : null,
                recipientName,
                recipientNameKey,
                amountCents: Number.isFinite(amount) && amount > 0 ? BigInt(Math.round(amount * 100)) : null,
                currency: 'USD',
                originalAmount: Number.isFinite(amount) ? amount : null,
                committedOn: partialDateStart({ text: String(result['Start Date'] ?? '').slice(0, 10) }),
                country: 'US',
                instrument: 'grant',
                description: result.Description ? String(result.Description).slice(0, 500) : null,
                isIntermediary: true,
            } satisfies PublicInvestmentRow,
        ]
    })
    return { rows, nextCursor: parsed.page_metadata?.hasNext ? String(page + 1) : null }
}

/**
 * Ask the AI for the rows on one page of text.
 *
 * @param input.ai - Model.
 * @param input.label - The institution, for context.
 * @param input.text - The page text.
 * @param input.pageUrl - The page URL.
 * @returns The extraction (null output on refusal) and its cost.
 */
async function extractRows({
    ai,
    label,
    text,
    pageUrl,
}: {
    ai: AiProvider
    label: string
    text: string
    pageUrl: string
}) {
    const result = await ai.completeStructured({
        instructions: EXTRACT_PUBLIC_INVESTMENTS_INSTRUCTIONS,
        prompt: `Institution: ${label}\nPage: ${pageUrl}\n\n<page>\n${text}\n</page>`,
        schema: ExtractedInvestmentPage,
        effort: 'low',
    })
    return {
        output: result.output,
        costMicroUsd: researchCostMicroUsd({
            model: result.model,
            inputTokens: result.usage?.inputTokens ?? 0,
            outputTokens: result.usage?.outputTokens ?? 0,
            webSearches: 0,
        }),
    }
}

/**
 * Cross-reference every fund against the stored public records (cheap: name-key lookups).
 *
 * @param input.now - Current time.
 * @returns Nothing.
 */
async function crossReferenceFunds({ now }: { now: Date }) {
    for (const fund of await listFundIdentities()) {
        const matched = await matchPublicRecordsToFund({
            fundManagerId: fund.id,
            nameKey: fund.name_key,
            researchRunId: null,
            now,
        })
        if (matched > 0) {
            await refreshFundResearchValues({ fundManagerId: fund.id })
        }
    }
}

/**
 * A URL's host, or null.
 *
 * @param input.url - The URL.
 * @returns Lowercased host.
 */
function safeHost({ url }: { url: string }) {
    try {
        return new URL(url).hostname.toLowerCase()
    } catch {
        return null
    }
}
