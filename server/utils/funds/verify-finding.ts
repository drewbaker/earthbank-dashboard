import type { z } from 'zod'
import type { FundResearchField } from '#shared/constants/funds.ts'
import { FUND_RESEARCH_FIELD_DETAILS, FUND_RESEARCH_FIELDS } from '#shared/constants/funds.ts'
import { COUNTRY_CODES } from '#shared/constants/regions.ts'
import type { FundFindingValues } from '#shared/schemas/fund-findings.ts'
import { FUND_FINDING_VALUE_SCHEMAS } from '#shared/schemas/fund-findings.ts'
import { organizationNameKey } from '#shared/funds/organization-names.ts'
import { isGeoFocusCode } from '#shared/utils/geo-focus.ts'

// The research assistant's claims are checked here, in code, before anything is stored: every
// finding must point at a page this run actually retrieved, and its supporting quote must appear in
// that page's text. That is what keeps made-up findings out, whatever the model says.

/** A page the research run fetched (web_fetch), with its text. */
export type RetrievedPage = { url: string; title: string | null; text: string }

/** A search result the run saw (web_search): only the address and title. */
export type SearchResult = { url: string; title: string | null }

/** Everything a research run actually retrieved, keyed by normalized URL. */
export type ResearchEvidence = {
    pages: Map<string, RetrievedPage>
    searchResults: Map<string, SearchResult>
}

/** A source that passed verification, ready to store. */
export type VerifiedSource = { url: string; title: string | null; quote: string | null }

export type Verification<Value> = { ok: true; value: Value; sources: VerifiedSource[] } | { ok: false; reason: string }

const COUNTRIES = new Set(COUNTRY_CODES)
const MIN_QUOTE_LENGTH = 8
const MAX_QUOTE_LENGTH = 300
const MAX_AMOUNT = 1e13
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|ref$|trk$)/i

/**
 * Build the evidence index for a run from what it retrieved.
 *
 * @param input.pages - Pages fetched during the run.
 * @param input.searchResults - Search results seen during the run.
 * @returns The evidence index.
 */
export function buildResearchEvidence({
    pages,
    searchResults,
}: {
    pages: RetrievedPage[]
    searchResults: SearchResult[]
}): ResearchEvidence {
    return {
        pages: new Map(pages.map(page => [normalizeUrl({ url: page.url }), page])),
        searchResults: new Map(searchResults.map(result => [normalizeUrl({ url: result.url }), result])),
    }
}

/**
 * Normalize a URL so the same page compares equal: lowercase host without "www.", no fragment,
 * no tracking parameters, no trailing slash.
 *
 * @param input.url - The URL.
 * @returns The normalized form (the input trimmed when it isn't a valid URL).
 */
export function normalizeUrl({ url }: { url: string }) {
    try {
        const parsed = new URL(url.trim())
        parsed.hash = ''
        // LinkedIn serves the same profile on country subdomains (ke.linkedin.com, ug.linkedin.com).
        parsed.hostname = parsed.hostname
            .toLowerCase()
            .replace(/^www\./, '')
            .replace(/^[a-z]{2}\.linkedin\.com$/, 'linkedin.com')
        for (const key of [...parsed.searchParams.keys()]) {
            if (TRACKING_PARAMS.test(key)) {
                parsed.searchParams.delete(key)
            }
        }
        const protocol = parsed.protocol === 'http:' ? 'https:' : parsed.protocol
        const path = parsed.pathname.replace(/\/+$/, '')
        return `${protocol}//${parsed.host}${path}${parsed.search}`
    } catch {
        return url.trim()
    }
}

/**
 * Flatten text for quote matching: lowercase, letters and digits only, single spaces.
 *
 * @param input.text - Page text or quote.
 * @returns The comparable text.
 */
export function normalizeForQuote({ text }: { text: string }) {
    return text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

/**
 * Check one research finding against what the run retrieved, and clean its value.
 *
 * @param input.field - The research field it claims to fill.
 * @param input.value - The value the AI proposed (unvalidated).
 * @param input.sourceUrls - Pages the AI says support it.
 * @param input.quote - The passage the AI says supports it.
 * @param input.confidence - The AI's confidence, 0–1.
 * @param input.minConfidence - Findings below this are dropped.
 * @param input.evidence - What the run actually retrieved.
 * @param input.now - Current time, for date range checks.
 * @returns The cleaned value with its verified sources, or why it was dropped.
 */
export function verifyFinding({
    field: proposedField,
    value,
    sourceUrls,
    quote,
    confidence,
    minConfidence,
    evidence,
    now,
}: {
    field: string
    value: unknown
    sourceUrls: string[]
    quote: string | null
    confidence: number
    minConfidence: number
    evidence: ResearchEvidence
    now: Date
}): Verification<{ field: FundResearchField; value: FundFindingValues[FundResearchField] }> {
    const field = asResearchField({ field: proposedField })
    if (!field || field === 'public_record') {
        return { ok: false, reason: 'unknown_field' }
    }
    if (!(confidence >= minConfidence)) {
        return { ok: false, reason: 'low_confidence' }
    }
    const parsed = (FUND_FINDING_VALUE_SCHEMAS[field] as z.ZodType).safeParse(value)
    if (!parsed.success) {
        return { ok: false, reason: 'invalid_value' }
    }
    const cleaned = cleanFindingValue({ field, value: parsed.data as FundFindingValues[typeof field], now })
    if (!cleaned) {
        return { ok: false, reason: 'out_of_range' }
    }
    if (FUND_RESEARCH_FIELD_DETAILS[field].isLinkOnly) {
        const url = (cleaned as { url: string }).url
        const sources = verifyLink({ url, sourceUrls, evidence })
        return sources
            ? { ok: true, value: { field, value: cleaned }, sources }
            : { ok: false, reason: 'link_not_seen' }
    }
    const sources = verifyQuotedSources({ sourceUrls, quote, evidence })
    return sources ? { ok: true, value: { field, value: cleaned }, sources } : { ok: false, reason: 'quote_not_found' }
}

/**
 * Keep the sources whose fetched text contains the quote.
 *
 * @param input.sourceUrls - Pages the AI cited.
 * @param input.quote - The supporting passage.
 * @param input.evidence - What the run retrieved.
 * @returns The sources that check out, or null when none does (or the quote is missing or too short).
 */
export function verifyQuotedSources({
    sourceUrls,
    quote,
    evidence,
}: {
    sourceUrls: string[]
    quote: string | null
    evidence: ResearchEvidence
}): VerifiedSource[] | null {
    const trimmedQuote = quote?.trim().slice(0, MAX_QUOTE_LENGTH) ?? ''
    const needle = normalizeForQuote({ text: trimmedQuote })
    if (needle.length < MIN_QUOTE_LENGTH) {
        return null
    }
    const sources: VerifiedSource[] = []
    for (const sourceUrl of uniqueUrls({ urls: sourceUrls })) {
        const page = evidence.pages.get(sourceUrl)
        if (page && normalizeForQuote({ text: page.text }).includes(needle)) {
            sources.push({ url: page.url, title: page.title, quote: trimmedQuote })
        }
    }
    return sources.length > 0 ? sources : null
}

/**
 * Check a link-only value (a LinkedIn or social URL): the link itself must have been seen, as a
 * search result or a fetched page, or appear in the text of a fetched source.
 *
 * @param input.url - The link being recorded.
 * @param input.sourceUrls - Pages the AI cited.
 * @param input.evidence - What the run retrieved.
 * @returns The verified sources, or null.
 */
export function verifyLink({
    url,
    sourceUrls,
    evidence,
}: {
    url: string
    sourceUrls: string[]
    evidence: ResearchEvidence
}): VerifiedSource[] | null {
    const target = normalizeUrl({ url })
    const seenAsResult = evidence.searchResults.get(target) ?? evidence.pages.get(target)
    if (seenAsResult) {
        return [{ url: seenAsResult.url, title: seenAsResult.title, quote: null }]
    }
    const bareTarget = target.replace(/^https?:\/\//, '')
    for (const sourceUrl of uniqueUrls({ urls: sourceUrls })) {
        const page = evidence.pages.get(sourceUrl)
        if (page && page.text.toLowerCase().replace(/www\./g, '').includes(bareTarget.toLowerCase())) {
            return [{ url: page.url, title: page.title, quote: null }]
        }
    }
    return null
}

/**
 * Whether a published email address appears verbatim on a page the run fetched.
 *
 * @param input.email - The address.
 * @param input.evidence - What the run retrieved.
 * @returns True when some fetched page contains it.
 */
export function isEmailPublished({ email, evidence }: { email: string; evidence: ResearchEvidence }) {
    const needle = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(needle)) {
        return false
    }
    for (const page of evidence.pages.values()) {
        if (page.text.toLowerCase().includes(needle)) {
            return true
        }
    }
    return false
}

/**
 * Whether a quote names an organization or person (so a work-history claim is about who it says).
 *
 * @param input.quote - The supporting passage.
 * @param input.name - The organization or person name.
 * @returns True when the quote contains the name's words.
 */
export function quoteMentions({ quote, name }: { quote: string | null; name: string }) {
    const haystack = ` ${normalizeForQuote({ text: quote ?? '' })} `
    const key = organizationNameKey({ name })
    return key.length > 0 && haystack.includes(` ${key} `)
}

/**
 * Whether a quote names a person, in any word order ("Badi Arorwa" names "Arorwa Badi").
 *
 * @param input.quote - The supporting passage.
 * @param input.name - The person's name.
 * @returns True when every part of the name appears as a word in the quote.
 */
export function quoteNamesPerson({ quote, name }: { quote: string | null; name: string }) {
    const words = new Set(normalizeForQuote({ text: quote ?? '' }).split(' '))
    const parts = normalizeForQuote({ text: name })
        .split(' ')
        .filter(part => part.length > 1)
    return parts.length > 0 && parts.every(part => words.has(part))
}

/**
 * The key two findings share when they say the same thing (one deal, one LP, one AUM figure).
 *
 * @param input.field - The research field.
 * @param input.value - The cleaned value.
 * @returns A stable key.
 */
export function findingValueKey({ field, value }: { field: FundResearchField; value: Record<string, unknown> }) {
    const text = (key: string) => organizationNameKey({ name: String(value[key] ?? '') })
    switch (field) {
        case 'deal':
            return `${text('borrower')}|${String(value.date ?? '').slice(0, 4)}`
        case 'lp':
            return `${text('name')}|${text('fund_name')}`
        case 'fund_raise':
            return text('fund_name')
        case 'news':
        case 'success_story':
            return text('title')
        case 'impact_metric':
            return text('metric')
        case 'conference':
            return `${text('name')}|${String(value.year ?? '')}`
        case 'social_account':
        case 'website_url':
        case 'linkedin_url':
            return normalizeUrl({ url: String(value.url ?? '') }).toLowerCase()
        case 'public_record':
            return `${String(value.source_key)}|${String(value.record_id)}`
        default:
            return stableStringify({ value })
    }
}

/**
 * Parse a partial date (YYYY, YYYY-MM, YYYY-MM-DD) to the first day it covers.
 *
 * @param input.text - The partial date.
 * @returns A UTC Date, or null when it isn't one.
 */
export function partialDateStart({ text }: { text: string | null | undefined }) {
    const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(text?.trim() ?? '')
    if (!match) {
        return null
    }
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2] ?? 1) - 1, Number(match[3] ?? 1)))
    return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Narrow a string to a research field key.
 *
 * @param input.field - Any string.
 * @returns The field key, or null when it isn't one.
 */
function asResearchField({ field }: { field: string }): FundResearchField | null {
    return (FUND_RESEARCH_FIELDS as readonly string[]).includes(field) ? (field as FundResearchField) : null
}

/**
 * Normalize and de-duplicate cited URLs.
 *
 * @param input.urls - Cited URLs.
 * @returns Normalized, unique URLs.
 */
function uniqueUrls({ urls }: { urls: string[] }) {
    return [...new Set(urls.map(url => normalizeUrl({ url })))]
}

/**
 * JSON with sorted keys, so equal values give equal strings.
 *
 * @param input.value - Any JSON value.
 * @returns The stable JSON text.
 */
function stableStringify({ value }: { value: unknown }): string {
    if (Array.isArray(value)) {
        return `[${value.map(item => stableStringify({ value: item })).join(',')}]`
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify({ value: item })}`).join(',')}}`
    }
    return JSON.stringify(value)
}

/**
 * Range-check and tidy a parsed value (uppercase codes, valid years and amounts, known countries).
 *
 * @param input.field - The research field.
 * @param input.value - The schema-valid value.
 * @param input.now - Current time.
 * @returns The cleaned value, or null when it fails a range check.
 */
function cleanFindingValue<Field extends FundResearchField>({
    field,
    value,
    now,
}: {
    field: Field
    value: FundFindingValues[Field]
    now: Date
}): FundFindingValues[Field] | null {
    const thisYear = now.getUTCFullYear()
    const v = value as Record<string, unknown>
    switch (field) {
        case 'summary': {
            const text = String(v.text).trim()
            return text.length >= 10 ? ({ text: text.slice(0, 600) } as FundFindingValues[Field]) : null
        }
        case 'website_url':
        case 'social_account':
            return isHttpUrl({ url: String(v.url) }) ? value : null
        case 'linkedin_url':
            return /linkedin\.com\/(company|school|showcase)\//i.test(String(v.url)) ? value : null
        case 'year_established':
            return Number(v.year) >= 1800 && Number(v.year) <= thisYear ? value : null
        case 'employee_count':
            return Number(v.count) >= 1 && Number(v.count) <= 1_000_000 ? value : null
        case 'headquarters': {
            const country = String(v.country).toUpperCase()
            return COUNTRIES.has(country) ? ({ ...v, country } as FundFindingValues[Field]) : null
        }
        case 'geographic_focus': {
            const codes = (v.codes as string[]).map(code =>
                code.startsWith('region:') || code === 'global' ? code : code.toUpperCase(),
            )
            const valid = [...new Set(codes.filter(code => isGeoFocusCode({ code })))]
            return valid.length > 0 ? ({ ...v, codes: valid } as FundFindingValues[Field]) : null
        }
        case 'sectors':
            return (v.sectors as string[]).length > 0
                ? ({ sectors: [...new Set(v.sectors as string[])] } as FundFindingValues[Field])
                : null
        case 'loan_types':
            return (v.types as string[]).length > 0
                ? ({ types: [...new Set(v.types as string[])] } as FundFindingValues[Field])
                : null
        case 'aum':
            return cleanMoney({ money: v }) && isPartialDateOk({ text: v.as_of, thisYear, allowNull: true })
                ? ({ ...v, currency: String(v.currency).toUpperCase() } as FundFindingValues[Field])
                : null
        case 'fund_raise': {
            const size = v.size === null ? null : cleanMoney({ money: v.size as Record<string, unknown> })
            if ((v.size !== null && !size) || !isPartialDateOk({ text: v.closed_on, thisYear, allowNull: true })) {
                return null
            }
            return { ...v, size } as FundFindingValues[Field]
        }
        case 'check_size': {
            const min = v.min as number | null
            const max = v.max as number | null
            const isValid =
                (min !== null || max !== null) &&
                (min === null || (min > 0 && min < MAX_AMOUNT)) &&
                (max === null || (max > 0 && max < MAX_AMOUNT)) &&
                (min === null || max === null || min <= max) &&
                /^[A-Za-z]{3}$/.test(String(v.currency))
            return isValid ? ({ ...v, currency: String(v.currency).toUpperCase() } as FundFindingValues[Field]) : null
        }
        case 'deal': {
            const amount = v.amount === null ? null : cleanMoney({ money: v.amount as Record<string, unknown> })
            const country = v.country === null ? null : String(v.country).toUpperCase()
            const isValid =
                String(v.borrower).trim().length > 1 &&
                (v.amount === null || amount !== null) &&
                (country === null || COUNTRIES.has(country)) &&
                isPartialDateOk({ text: v.date, thisYear, allowNull: true })
            return isValid ? ({ ...v, amount, country } as FundFindingValues[Field]) : null
        }
        case 'lp': {
            const amount = v.amount === null ? null : cleanMoney({ money: v.amount as Record<string, unknown> })
            return String(v.name).trim().length > 1 && (v.amount === null || amount !== null)
                ? ({ ...v, amount } as FundFindingValues[Field])
                : null
        }
        case 'impact_metric':
            return String(v.metric).trim() &&
                String(v.value).trim() &&
                isPartialDateOk({ text: v.as_of, thisYear, allowNull: true })
                ? value
                : null
        case 'success_story':
            return String(v.title).trim() && String(v.summary).trim() ? value : null
        case 'news':
            return String(v.title).trim() && isPartialDateOk({ text: v.published_on, thisYear, allowNull: true })
                ? value
                : null
        case 'conference': {
            const year = v.year as number | null
            return String(v.name).trim() && (year === null || (year >= 1990 && year <= thisYear + 1)) ? value : null
        }
        default:
            return null
    }
}

/**
 * Validate an amount: positive, below a sanity ceiling, with a three-letter currency.
 *
 * @param input.money - `{ amount, currency }`.
 * @returns The amount with an uppercase currency, or null.
 */
function cleanMoney({ money }: { money: Record<string, unknown> }) {
    const amount = Number(money.amount)
    const currency = String(money.currency ?? '').toUpperCase()
    if (!(amount > 0 && amount < MAX_AMOUNT) || !/^[A-Z]{3}$/.test(currency)) {
        return null
    }
    return { amount, currency }
}

/**
 * Check a partial date is well formed and not in the future (beyond next year).
 *
 * @param input.text - The partial date or null.
 * @param input.thisYear - Current year.
 * @param input.allowNull - Whether null is acceptable.
 * @returns True when acceptable.
 */
function isPartialDateOk({ text, thisYear, allowNull }: { text: unknown; thisYear: number; allowNull: boolean }) {
    if (text === null || text === undefined) {
        return allowNull
    }
    const date = partialDateStart({ text: String(text) })
    return date !== null && date.getUTCFullYear() >= 1950 && date.getUTCFullYear() <= thisYear + 1
}

/**
 * Whether a string is an http(s) URL with a dotted host.
 *
 * @param input.url - Candidate URL.
 * @returns True when usable.
 */
function isHttpUrl({ url }: { url: string }) {
    try {
        const parsed = new URL(url)
        return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.includes('.')
    } catch {
        return false
    }
}
