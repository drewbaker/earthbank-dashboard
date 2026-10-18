import { z } from 'zod'
import { findFundManagerByDomain, updateFundManagerColumns } from '#server/database/fund-managers.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { IDENTIFY_FUND_INSTRUCTIONS } from '#server/utils/ai/instructions.ts'
import { researchCostMicroUsd } from '#server/utils/ai/web-research.ts'
import type { BrowserReads } from '#server/utils/funds/groundwork.ts'
import { addSearchHits, homePage } from '#server/utils/funds/groundwork.ts'
import type { ResearchEvidence } from '#server/utils/funds/verify-finding.ts'
import { normalizeForQuote, normalizeUrl } from '#server/utils/funds/verify-finding.ts'
import type { WebReader, WebSearchHit } from '#server/utils/web/types.ts'
import type { IdentityCandidate } from '#shared/schemas/funds.ts'
import { canonicalLinkedinUrl, organizationNameKey, websiteDomain } from '#shared/funds/organization-names.ts'

// Finding a fund's own website and LinkedIn page when we only know its name. Names are often common
// ("Spring Bank"), so this looks through the impact and climate lens Earth Bank cares about, uses what
// we know about how the fund came up, checks impact directories that list official websites, reads the
// top candidates' home pages, and treats a website and LinkedIn page that point at each other as
// confirming one another. What it still can't decide is kept as candidates for a person to confirm.

// Hosts that are never a fund's own website.
const NOT_A_FUND_SITE = [
    'linkedin.com',
    'twitter.com',
    'x.com',
    'facebook.com',
    'instagram.com',
    'youtube.com',
    'crunchbase.com',
    'pitchbook.com',
    'wikipedia.org',
    'bloomberg.com',
    'medium.com',
    'cbinsights.com',
    'tracxn.com',
    'zoominfo.com',
    'glassdoor.com',
    'bcorporation.net',
    'ofn.org',
    'thegiin.org',
    'convergence.finance',
    'devex.com',
    'dnb.com',
]

// Impact directories whose listings link to the organization's official website.
const IMPACT_DIRECTORIES = ['bcorporation.net', 'ofn.org', 'thegiin.org', 'convergence.finance']

// Words that suggest an impact or climate lender, used to rank candidates (never to decide alone).
const IMPACT_WORDS = [
    'impact',
    'climate',
    'cdfi',
    'community development',
    'small business',
    'smes',
    'sme',
    'lending',
    'lender',
    'loans',
    'credit',
    'debt',
    'financing',
    'microfinance',
    'renewable',
    'clean energy',
    'agriculture',
    'farmers',
    'blended finance',
    'emerging markets',
    'b corp',
]

// The model's pick is used at this confidence; a pair that links to itself needs less.
const MIN_PICK_CONFIDENCE = 0.8
const MIN_CONFIRMED_PAIR_CONFIDENCE = 0.5
const MAX_HOME_PAGES = 3
const MAX_CANDIDATES = 5
const HOME_PAGE_EXCERPT = 1_500

const IdentityChoice = z.object({
    website_url: z.string().nullable(),
    website_confidence: z.number(),
    linkedin_url: z.string().nullable(),
    linkedin_confidence: z.number(),
})

/** A website candidate while it's being weighed. */
type WebsiteCandidate = {
    url: string
    title: string | null
    snippet: string | null
    homeText: string | null
    linkedinLinks: string[]
    signals: string[]
}

/**
 * Pin down a fund's own website and LinkedIn company page.
 *
 * Steps, each only while something is still unknown: impact-lens and hint searches; impact directory
 * listings (B Corp, OFN, GIIN, Convergence) for the official website; the top candidates' home pages;
 * pairing websites with LinkedIn pages that link to each other; then one cheap model call that picks
 * among what we actually saw (anything else it names is ignored). Unsure picks aren't used; the
 * candidates are returned for a person to confirm.
 *
 * @param input.fundManagerId - The fund.
 * @param input.fundName - Its name.
 * @param input.websiteUrl - Its website, if already known.
 * @param input.linkedinUrl - Its LinkedIn page, if already known.
 * @param input.hints - What we know about it (how it came up, region, the team's notes).
 * @param input.linkedInHits - LinkedIn search results already fetched for the fund.
 * @param input.reader - Firecrawl.
 * @param input.classifier - The model that picks; null skips the pick.
 * @param input.browsing - The run's Firecrawl reads (mutated).
 * @param input.evidence - The run's live evidence (mutated).
 * @returns The website and LinkedIn page now known, candidates left for a person, and the model cost.
 */
export async function establishIdentity({
    fundManagerId,
    fundName,
    websiteUrl,
    linkedinUrl,
    hints,
    linkedInHits,
    reader,
    classifier,
    browsing,
    evidence,
}: {
    fundManagerId: string
    fundName: string
    websiteUrl: string | null
    linkedinUrl: string | null
    hints: string[]
    linkedInHits: WebSearchHit[]
    reader: WebReader
    classifier: AiProvider | null
    browsing: BrowserReads
    evidence: ResearchEvidence
}) {
    if ((websiteUrl && linkedinUrl) || !classifier) {
        return { websiteUrl, linkedinUrl, candidates: [] as IdentityCandidate[], costMicroUsd: 0 }
    }
    const websites = websiteUrl ? [] : await findWebsiteCandidates({ fundName, hints, reader, browsing, evidence })
    await readHomePages({ candidates: websites.slice(0, MAX_HOME_PAGES), reader, browsing, evidence })
    const linkedins = linkedinUrl ? [] : linkedinCandidates({ linkedInHits, websites })
    const pairs = confirmedPairs({ websites, linkedins })

    if (websites.length === 0 && linkedins.length === 0) {
        return { websiteUrl, linkedinUrl, candidates: [] as IdentityCandidate[], costMicroUsd: 0 }
    }
    const choice = await classifier.completeStructured({
        instructions: IDENTIFY_FUND_INSTRUCTIONS,
        prompt: buildIdentityPrompt({ fundName, hints, websiteUrl, linkedinUrl, websites, linkedins, pairs }),
        schema: IdentityChoice,
        effort: 'low',
    })
    const costMicroUsd = researchCostMicroUsd({
        model: choice.model,
        inputTokens: choice.usage?.inputTokens ?? 0,
        outputTokens: choice.usage?.outputTokens ?? 0,
        webSearches: 0,
    })
    const pick = choice.status === 'ok' ? choice.output : null
    const pickedWebsite = websiteUrl
        ? null
        : acceptPick({
              url: pick?.website_url ?? null,
              confidence: pick?.website_confidence ?? 0,
              seen: websites.map(candidate => candidate.url),
              isConfirmed: url => pairs.some(pair => sameUrl({ a: pair.website, b: url })),
          })
    const pickedLinkedin = linkedinUrl
        ? null
        : acceptPick({
              url: pick?.linkedin_url ?? null,
              confidence: pick?.linkedin_confidence ?? 0,
              seen: linkedins.map(candidate => candidate.url),
              isConfirmed: url => pairs.some(pair => sameUrl({ a: pair.linkedin, b: url })),
          })

    const website = pickedWebsite ? homePage({ url: pickedWebsite }) : null
    const domain = websiteDomain({ url: website })
    const domainOwner = domain ? await findFundManagerByDomain({ websiteDomain: domain }) : null
    const canUseWebsite = Boolean(website && domain && (!domainOwner || domainOwner.id === fundManagerId))
    const linkedin = pickedLinkedin ? canonicalLinkedinUrl({ url: pickedLinkedin }) : null
    if (canUseWebsite || linkedin) {
        await updateFundManagerColumns({
            fundManagerId,
            data: {
                ...(canUseWebsite ? { website_url: website, website_domain: domain } : {}),
                ...(linkedin ? { linkedin_url: linkedin } : {}),
            },
        })
    }
    const candidates: IdentityCandidate[] = [
        ...(canUseWebsite || websiteUrl
            ? []
            : websites
                  .slice(0, MAX_CANDIDATES)
                  .map(candidate => toIdentityCandidate({ candidate, kind: 'website' as const }))),
        ...(linkedin || linkedinUrl ? [] : linkedins.slice(0, MAX_CANDIDATES)),
    ]
    return {
        websiteUrl: canUseWebsite ? website : websiteUrl,
        linkedinUrl: linkedin ?? linkedinUrl,
        candidates,
        costMicroUsd,
    }
}

/**
 * Accept the model's pick only if it's one we saw, and it's sure (or less sure but the website and
 * LinkedIn page confirm each other).
 *
 * @param input.url - The model's pick, or null.
 * @param input.confidence - Its confidence.
 * @param input.seen - URLs that were candidates.
 * @param input.isConfirmed - Whether a URL is part of a confirmed website–LinkedIn pair.
 * @returns The accepted URL, or null.
 */
export function acceptPick({
    url,
    confidence,
    seen,
    isConfirmed,
}: {
    url: string | null
    confidence: number
    seen: string[]
    isConfirmed: (url: string) => boolean
}) {
    if (!url || !seen.some(candidate => sameUrl({ a: candidate, b: url }))) {
        return null
    }
    const needed = isConfirmed(url) ? MIN_CONFIRMED_PAIR_CONFIDENCE : MIN_PICK_CONFIDENCE
    return confidence >= needed ? url : null
}

/**
 * Rank website candidates: the name in the domain or title, listing in an impact directory, impact or
 * climate words, and a matching hint (country, city) each add weight.
 *
 * @param input.fundName - The fund's name.
 * @param input.hints - What we know about it.
 * @param input.candidate - The candidate.
 * @returns A score (higher is more likely).
 */
export function scoreWebsiteCandidate({
    fundName,
    hints,
    candidate,
}: {
    fundName: string
    hints: string[]
    candidate: Pick<WebsiteCandidate, 'url' | 'title' | 'snippet' | 'homeText' | 'signals'>
}) {
    const nameWords = organizationNameKey({ name: fundName })
        .split(' ')
        .filter(word => word.length >= 3)
    const domain = (websiteDomain({ url: candidate.url }) ?? '').replace(/[^a-z0-9]/g, '')
    const text = normalizeForQuote({
        text: [candidate.title, candidate.snippet, candidate.homeText].filter(Boolean).join(' '),
    })
    let score = 0
    if (nameWords.length > 0 && nameWords.every(word => domain.includes(word))) {
        score += 3
    } else if (nameWords.some(word => word.length >= 4 && domain.includes(word))) {
        score += 1
    }
    if (nameWords.length > 0 && nameWords.every(word => text.includes(word))) {
        score += 1
    }
    if (candidate.signals.some(signal => signal.startsWith('Listed on'))) {
        score += 3
    }
    score += Math.min(3, IMPACT_WORDS.filter(word => ` ${text} `.includes(` ${word} `)).length)
    const hintWords = hints
        .flatMap(hint => normalizeForQuote({ text: hint }).split(' '))
        .filter(word => word.length >= 4 && !nameWords.includes(word))
    if (hintWords.some(word => text.includes(word))) {
        score += 2
    }
    return score
}

/**
 * Website candidates from impact-lens searches, hint searches and impact directories, best first.
 *
 * @param input.fundName - The fund's name.
 * @param input.hints - What we know about it.
 * @param input.reader - Firecrawl.
 * @param input.browsing - The run's Firecrawl reads (mutated).
 * @param input.evidence - The run's live evidence (mutated).
 * @returns Candidates, best first.
 */
async function findWebsiteCandidates({
    fundName,
    hints,
    reader,
    browsing,
    evidence,
}: {
    fundName: string
    hints: string[]
    reader: WebReader
    browsing: BrowserReads
    evidence: ResearchEvidence
}) {
    const shortHint = hints[0]?.split(/[;.]/)[0]?.trim().slice(0, 40)
    const queries = [
        `"${fundName}" (impact OR climate OR lending OR "small business" OR CDFI OR fund)`,
        ...(shortHint ? [`"${fundName}" ${shortHint}`] : []),
    ]
    const byDomain = new Map<string, WebsiteCandidate>()
    const add = (candidate: WebsiteCandidate) => {
        const domain = websiteDomain({ url: candidate.url })
        if (!domain || isNotFundSite({ url: candidate.url })) {
            return
        }
        const existing = byDomain.get(domain)
        if (existing) {
            existing.signals.push(...candidate.signals.filter(signal => !existing.signals.includes(signal)))
            existing.snippet ??= candidate.snippet
        } else {
            byDomain.set(domain, candidate)
        }
    }
    for (const query of queries) {
        const result = await search({ reader, query, limit: 8, browsing, evidence })
        result.forEach(hit =>
            add({
                url: hit.url,
                title: hit.title,
                snippet: hit.snippet,
                homeText: null,
                linkedinLinks: [],
                signals: [],
            }),
        )
    }
    for (const listing of await directoryWebsites({ fundName, reader, browsing, evidence })) {
        add(listing)
    }
    return [...byDomain.values()].sort(
        (a, b) =>
            scoreWebsiteCandidate({ fundName, hints, candidate: b }) -
            scoreWebsiteCandidate({ fundName, hints, candidate: a }),
    )
}

/**
 * The official websites impact directories list for the fund (B Corp, OFN, GIIN, Convergence).
 *
 * @param input.fundName - The fund's name.
 * @param input.reader - Firecrawl.
 * @param input.browsing - The run's Firecrawl reads (mutated).
 * @param input.evidence - The run's live evidence (mutated).
 * @returns Website candidates backed by a directory listing.
 */
async function directoryWebsites({
    fundName,
    reader,
    browsing,
    evidence,
}: {
    fundName: string
    reader: WebReader
    browsing: BrowserReads
    evidence: ResearchEvidence
}) {
    const query = `"${fundName}" (${IMPACT_DIRECTORIES.map(domain => `site:${domain}`).join(' OR ')})`
    const hits = await search({ reader, query, limit: 5, browsing, evidence })
    const nameKey = organizationNameKey({ name: fundName })
    const listing = hits.find(
        hit =>
            IMPACT_DIRECTORIES.some(domain => (websiteDomain({ url: hit.url }) ?? '').endsWith(domain)) &&
            normalizeForQuote({ text: hit.title ?? '' }).includes(nameKey),
    )
    if (!listing) {
        return []
    }
    const { page, credits } = await reader.readPage({ url: listing.url })
    browsing.credits += credits
    browsing.reads += 1
    const directory = websiteDomain({ url: listing.url }) ?? 'a directory'
    const nameWords = nameKey.split(' ').filter(word => word.length >= 4)
    return (page?.links ?? [])
        .filter(link => !isNotFundSite({ url: link }) && /^https?:\/\//i.test(link))
        .filter(link =>
            nameWords.some(word => (websiteDomain({ url: link }) ?? '').replace(/[^a-z0-9]/g, '').includes(word)),
        )
        .slice(0, 2)
        .map(link => ({
            url: homePage({ url: link }),
            title: listing.title,
            snippet: listing.snippet,
            homeText: null,
            linkedinLinks: [],
            signals: [`Listed on ${directory}`],
        }))
}

/**
 * Read the top candidates' home pages: an excerpt for the model, and the LinkedIn links on them.
 *
 * @param input.candidates - Website candidates to read (mutated with what was found).
 * @param input.reader - Firecrawl.
 * @param input.browsing - The run's Firecrawl reads (mutated).
 * @param input.evidence - The run's live evidence (mutated).
 * @returns Nothing.
 */
async function readHomePages({
    candidates,
    reader,
    browsing,
    evidence,
}: {
    candidates: WebsiteCandidate[]
    reader: WebReader
    browsing: BrowserReads
    evidence: ResearchEvidence
}) {
    for (const candidate of candidates) {
        const home = homePage({ url: candidate.url })
        const { page, credits } = await reader.readPage({ url: home, waitForMs: 1000 })
        browsing.credits += credits
        browsing.reads += 1
        if (!page) {
            continue
        }
        candidate.homeText = page.markdown.slice(0, HOME_PAGE_EXCERPT)
        candidate.linkedinLinks = page.links
            .filter(link => /linkedin\.com\/company\//i.test(link))
            .map(link => canonicalLinkedinUrl({ url: link }))
        const retrieved = { url: page.url, title: page.title, text: page.markdown }
        browsing.pages.push(retrieved)
        evidence.pages.set(normalizeUrl({ url: page.url }), retrieved)
    }
}

/**
 * LinkedIn company page candidates: from the LinkedIn search, and from candidate websites' own links.
 *
 * @param input.linkedInHits - LinkedIn search results.
 * @param input.websites - Website candidates (with the LinkedIn links on their home pages).
 * @returns Candidates, the ones a website links to first.
 */
function linkedinCandidates({
    linkedInHits,
    websites,
}: {
    linkedInHits: WebSearchHit[]
    websites: WebsiteCandidate[]
}) {
    const byUrl = new Map<string, IdentityCandidate>()
    for (const website of websites) {
        for (const link of website.linkedinLinks) {
            byUrl.set(link, {
                kind: 'linkedin',
                url: link,
                title: null,
                snippet: null,
                signals: [`Linked from ${websiteDomain({ url: website.url })}`],
            })
        }
    }
    for (const hit of linkedInHits.filter(hit => /linkedin\.com\/company\//i.test(hit.url))) {
        const url = canonicalLinkedinUrl({ url: hit.url })
        const existing = byUrl.get(url)
        byUrl.set(
            url,
            existing
                ? { ...existing, title: hit.title, snippet: hit.snippet }
                : { kind: 'linkedin', url, title: hit.title, snippet: hit.snippet, signals: [] },
        )
    }
    return [...byUrl.values()]
}

/**
 * Website–LinkedIn pairs that confirm each other: the website links to the LinkedIn page, or the
 * LinkedIn result's text names the website's domain.
 *
 * @param input.websites - Website candidates.
 * @param input.linkedins - LinkedIn candidates.
 * @returns Confirmed pairs.
 */
export function confirmedPairs({
    websites,
    linkedins,
}: {
    websites: Pick<WebsiteCandidate, 'url' | 'linkedinLinks'>[]
    linkedins: Pick<IdentityCandidate, 'url' | 'title' | 'snippet'>[]
}) {
    const pairs: { website: string; linkedin: string }[] = []
    for (const website of websites) {
        const domain = websiteDomain({ url: website.url }) ?? ''
        for (const linkedin of linkedins) {
            const linksIt = website.linkedinLinks.some(link => sameUrl({ a: link, b: linkedin.url }))
            const namesIt =
                Boolean(domain) && `${linkedin.title ?? ''} ${linkedin.snippet ?? ''}`.toLowerCase().includes(domain)
            if (linksIt || namesIt) {
                pairs.push({ website: website.url, linkedin: linkedin.url })
            }
        }
    }
    return pairs
}

/**
 * The prompt for the identity pick.
 *
 * @param input.fundName - The fund's name.
 * @param input.hints - What we know about it.
 * @param input.websiteUrl - Its website, if known.
 * @param input.linkedinUrl - Its LinkedIn page, if known.
 * @param input.websites - Website candidates.
 * @param input.linkedins - LinkedIn candidates.
 * @param input.pairs - Pairs that confirm each other.
 * @returns The prompt.
 */
function buildIdentityPrompt({
    fundName,
    hints,
    websiteUrl,
    linkedinUrl,
    websites,
    linkedins,
    pairs,
}: {
    fundName: string
    hints: string[]
    websiteUrl: string | null
    linkedinUrl: string | null
    websites: WebsiteCandidate[]
    linkedins: IdentityCandidate[]
    pairs: { website: string; linkedin: string }[]
}) {
    const websiteLines = websites
        .slice(0, MAX_CANDIDATES)
        .map(
            (candidate, index) =>
                `${index + 1}. ${candidate.url}\n   ${candidate.title ?? ''}\n   ${candidate.snippet ?? ''}${
                    candidate.signals.length ? `\n   (${candidate.signals.join('; ')})` : ''
                }${candidate.homeText ? `\n   Home page: ${candidate.homeText.replace(/\s+/g, ' ').slice(0, 600)}` : ''}`,
        )
    const linkedinLines = linkedins
        .slice(0, MAX_CANDIDATES)
        .map(
            (candidate, index) =>
                `${index + 1}. ${candidate.url}\n   ${candidate.title ?? ''}\n   ${candidate.snippet ?? ''}${
                    candidate.signals.length ? `\n   (${candidate.signals.join('; ')})` : ''
                }`,
        )
    return [
        `Lender: ${fundName}`,
        hints.length ? `What we know about it: ${hints.join(' | ')}` : '',
        websiteUrl ? `Website (known): ${websiteUrl}` : `Website candidates:\n${websiteLines.join('\n') || '(none)'}`,
        linkedinUrl
            ? `LinkedIn page (known): ${linkedinUrl}`
            : `LinkedIn company page candidates:\n${linkedinLines.join('\n') || '(none)'}`,
        pairs.length
            ? `These website and LinkedIn pages point at each other: ${pairs.map(pair => `${pair.website} ↔ ${pair.linkedin}`).join('; ')}`
            : '',
    ]
        .filter(Boolean)
        .join('\n\n')
}

/**
 * A search that records its results as evidence and counts its credits.
 *
 * @param input.reader - Firecrawl.
 * @param input.query - The query.
 * @param input.limit - Most results.
 * @param input.browsing - The run's Firecrawl reads (mutated).
 * @param input.evidence - The run's live evidence (mutated).
 * @returns The results.
 */
async function search({
    reader,
    query,
    limit,
    browsing,
    evidence,
}: {
    reader: WebReader
    query: string
    limit: number
    browsing: BrowserReads
    evidence: ResearchEvidence
}) {
    const result = await reader.search({ query, limit })
    browsing.credits += result.credits
    browsing.searches += 1
    addSearchHits({ hits: result.hits, browsing, evidence })
    return result.hits
}

/**
 * A website candidate as stored for a person to confirm.
 *
 * @param input.candidate - The candidate.
 * @param input.kind - `website`.
 * @returns The stored shape.
 */
function toIdentityCandidate({ candidate, kind }: { candidate: WebsiteCandidate; kind: 'website' }): IdentityCandidate {
    return {
        kind,
        url: homePage({ url: candidate.url }),
        title: candidate.title,
        snippet: candidate.snippet,
        signals: candidate.signals,
    }
}

/**
 * Whether a URL is on a host that's never a fund's own website.
 *
 * @param input.url - The URL.
 * @returns True when it can't be the fund's site.
 */
function isNotFundSite({ url }: { url: string }) {
    const host = websiteDomain({ url }) ?? ''
    return NOT_A_FUND_SITE.some(domain => host === domain || host.endsWith(`.${domain}`))
}

/**
 * Whether two URLs are the same page (or, for websites, the same site).
 *
 * @param input.a - One URL.
 * @param input.b - The other.
 * @returns True when they match.
 */
function sameUrl({ a, b }: { a: string; b: string }) {
    if (/linkedin\.com/i.test(a) || /linkedin\.com/i.test(b)) {
        return canonicalLinkedinUrl({ url: a }).toLowerCase() === canonicalLinkedinUrl({ url: b }).toLowerCase()
    }
    return websiteDomain({ url: a }) === websiteDomain({ url: b })
}
