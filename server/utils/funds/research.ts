import { z } from 'zod'
import { findFundManager, setFundResearchStatus } from '#server/database/fund-managers.ts'
import type {
    AffiliationToSave,
    DiligenceToSave,
    FindingToSave,
    PersonToSave,
    SourceToLink,
} from '#server/database/fund-research.ts'
import {
    createFundResearchRun,
    finishFundResearchRun,
    listFundFindings,
    listFundPeople,
    saveResearchResults,
} from '#server/database/fund-research.ts'
import type { AiProvider, AiTool } from '#server/utils/ai/provider.ts'
import { FUND_RESEARCH_INSTRUCTIONS } from '#server/utils/ai/instructions.ts'
import type { WebResearcher } from '#server/utils/ai/web-research.ts'
import { matchPublicRecordsToFund } from '#server/utils/funds/public-records.ts'
import { refreshFundResearchValues } from '#server/utils/funds/refresh-values.ts'
import { readFundResearchSettings, readMonthResearchSpend } from '#server/utils/funds/research-settings.ts'
import type { LenderCandidate } from '#server/utils/funds/spider.ts'
import { discoverLenders } from '#server/utils/funds/spider.ts'
import type { ResearchEvidence, VerifiedSource } from '#server/utils/funds/verify-finding.ts'
import {
    buildResearchEvidence,
    findingValueKey,
    isEmailPublished,
    normalizeUrl,
    quoteMentions,
    verifyFinding,
    verifyLink,
    verifyQuotedSources,
} from '#server/utils/funds/verify-finding.ts'
import type { FundResearchField, FundSourceKind } from '#shared/constants/funds.ts'
import {
    AFFILIATION_RELATIONS,
    FUND_DILIGENCE_QUESTIONS,
    FUND_RESEARCH_FIELD_DETAILS,
    FUND_RESEARCH_FIELDS,
    RESEARCH_ORGANIZATION_KINDS,
} from '#shared/constants/funds.ts'
import { FUND_FINDING_VALUE_SCHEMAS } from '#shared/schemas/fund-findings.ts'
import { organizationNameKey, websiteDomain } from '#shared/funds/organization-names.ts'

// Domains whose pages are DFI or multilateral investment records.
const DFI_DOMAINS = [
    'norfund.no',
    'bii.co.uk',
    'fmo.nl',
    'proparco.fr',
    'deginvest.de',
    'swedfund.se',
    'finnfund.fi',
    'ifu.dk',
    'ifc.org',
    'idbinvest.org',
    'afdb.org',
    'adb.org',
    'eib.org',
    'dfc.gov',
    'convergence.finance',
]
const PRESS_WIRE_DOMAINS = [
    'prnewswire.com',
    'businesswire.com',
    'globenewswire.com',
    'accesswire.com',
    'einpresswire.com',
]

const SourceFields = {
    source_urls: z.array(z.string()).describe('Pages you fetched in this session that state it.'),
    quote: z.string().describe('A short passage copied word for word from one of those pages.'),
}

// One tool input per field, so the model sees exactly which value shape each field takes.
const FindingInput = z.discriminatedUnion(
    'field',
    FUND_RESEARCH_FIELDS.filter(field => field !== 'public_record').map(field =>
        z.object({ field: z.literal(field), value: FUND_FINDING_VALUE_SCHEMAS[field] }),
    ) as unknown as [z.ZodObject, ...z.ZodObject[]],
)

/** A proposal the model made during the run, checked against the evidence when the run ends. */
type Proposals = {
    findings: { field: string; value: unknown; sourceUrls: string[]; quote: string | null; confidence: number }[]
    people: {
        name: string
        title: string | null
        isPrincipal: boolean
        linkedinUrl: string | null
        email: string | null
        bioSummary: string | null
        sourceUrls: string[]
        quote: string
    }[]
    affiliations: {
        personName: string
        organizationName: string
        organizationKind: (typeof RESEARCH_ORGANIZATION_KINDS)[number]
        relation: (typeof AFFILIATION_RELATIONS)[number]
        title: string | null
        startYear: number | null
        endYear: number | null
        sourceUrls: string[]
        quote: string
    }[]
    lenders: { name: string; website: string | null; relation: string; sourceUrls: string[]; quote: string }[]
    diligence: { question: string; answer: string; sourceUrls: string[]; quote: string; confidence: number }[]
}

/** What one research run did. */
export type FundResearchOutcome =
    | { status: 'done'; findingsAdded: number; findingsDropped: number; fundsDiscovered: number; costUsd: number }
    | { status: 'skipped'; reason: string }

/**
 * Research one fund from public sources and store what checks out.
 *
 * 1. Stop (status `skipped`) when this month's research budget is spent.
 * 2. Let the model search and read the web, recording findings, people, work history, other lenders
 *    and diligence answers through tools.
 * 3. Check every proposal against the pages the run actually retrieved (verifyFinding and friends);
 *    store only what passes.
 * 4. Cross-reference public investment lists, recompute the sortable values, and queue research for
 *    new lenders it turned up.
 *
 * @param input.fundManagerId - The fund to research.
 * @param input.researcher - The web researcher (Claude with web search and fetch).
 * @param input.classifier - Model used to decide whether spidered organizations are lenders; null skips the spider.
 * @param input.now - Current time.
 * @returns What the run did.
 */
export async function researchFund({
    fundManagerId,
    researcher,
    classifier,
    now,
}: {
    fundManagerId: string
    researcher: WebResearcher
    classifier: AiProvider | null
    now: Date
}): Promise<FundResearchOutcome> {
    const fund = await findFundManager({ fundManagerId })
    if (!fund || fund.archived_at) {
        return { status: 'skipped', reason: 'Fund not found or archived' }
    }
    const settings = await readFundResearchSettings()
    if ((await readMonthResearchSpend({ settings, now })).isOverBudget) {
        await setFundResearchStatus({
            fundManagerId,
            status: 'skipped',
            error: "This month's research budget is spent.",
            now,
        })
        return { status: 'skipped', reason: 'Monthly research budget spent' }
    }

    await setFundResearchStatus({ fundManagerId, status: 'running', now })
    const run = await createFundResearchRun({ fundManagerId, model: researcher.model, now })
    try {
        const proposals: Proposals = { findings: [], people: [], affiliations: [], lenders: [], diligence: [] }
        const evidence = buildResearchEvidence({ pages: [], searchResults: [] })
        const result = await researcher.researchWithWeb({
            instructions: FUND_RESEARCH_INSTRUCTIONS,
            prompt: await buildResearchPrompt({ fundManagerId, name: fund.name, websiteUrl: fund.website_url, now }),
            tools: buildResearchTools({ proposals, evidence, minConfidence: settings.min_confidence, now }),
            maxSearches: settings.max_searches_per_fund,
            maxFetches: settings.max_fetches_per_fund,
            onRetrieved: ({ pages, searchResults }) => addEvidence({ evidence, pages, searchResults }),
        })
        const finalEvidence = buildResearchEvidence({ pages: result.pages, searchResults: result.searchResults })
        const verified = verifyProposals({
            proposals,
            evidence: finalEvidence,
            minConfidence: settings.min_confidence,
            fundDomain: fund.website_domain,
            now,
        })
        const saved = await saveResearchResults({
            fundManagerId,
            researchRunId: run.id,
            findings: verified.findings,
            people: verified.people,
            affiliations: verified.affiliations,
            diligence: verified.diligence,
            now,
        })
        await matchPublicRecordsToFund({ fundManagerId, nameKey: fund.name_key, researchRunId: run.id, now })
        await refreshFundResearchValues({ fundManagerId })

        const discovered = classifier
            ? await discoverLenders({
                  candidates: [
                      ...saved.organizationIds.map(organizationId => ({
                          type: 'organization' as const,
                          organizationId,
                      })),
                      ...verified.lenders,
                  ],
                  discoveredFromId: fundManagerId,
                  classifier,
                  now,
              })
            : 0

        await finishFundResearchRun({
            researchRunId: run.id,
            data: {
                status: 'done',
                finished_at: new Date(),
                model: result.model,
                input_tokens: result.usage.inputTokens,
                output_tokens: result.usage.outputTokens,
                web_searches: result.usage.webSearches,
                web_fetches: result.usage.webFetches,
                cost_micro_usd: result.usage.costMicroUsd,
                findings_added: saved.added,
                findings_dropped: verified.droppedCount,
                funds_discovered: discovered,
            },
        })
        await setFundResearchStatus({ fundManagerId, status: 'done', now: new Date() })
        return {
            status: 'done',
            findingsAdded: saved.added,
            findingsDropped: verified.droppedCount,
            fundsDiscovered: discovered,
            costUsd: result.usage.costMicroUsd / 1_000_000,
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[research] fund research failed', fundManagerId, error)
        await finishFundResearchRun({
            researchRunId: run.id,
            data: { status: 'failed', finished_at: new Date(), error: message.slice(0, 500) },
        })
        await setFundResearchStatus({ fundManagerId, status: 'failed', error: message.slice(0, 500), now: new Date() })
        throw error
    }
}

/**
 * Check every proposal against the evidence and shape what passes for storage.
 *
 * @param input.proposals - What the model proposed.
 * @param input.evidence - Everything the run retrieved.
 * @param input.minConfidence - Confidence floor for findings and diligence answers.
 * @param input.fundDomain - The fund's own domain (to label its pages).
 * @param input.now - Current time.
 * @returns Verified findings, people, affiliations, lender candidates, diligence answers, and how many proposals were dropped.
 */
export function verifyProposals({
    proposals,
    evidence,
    minConfidence,
    fundDomain,
    now,
}: {
    proposals: Proposals
    evidence: ResearchEvidence
    minConfidence: number
    fundDomain: string | null
    now: Date
}) {
    let droppedCount = 0
    const toSources = (sources: VerifiedSource[]): SourceToLink[] =>
        sources.map(source => ({ ...source, kind: classifySourceKind({ url: source.url, fundDomain }) }))

    const findings: FindingToSave[] = []
    for (const proposal of proposals.findings) {
        const checked = verifyFinding({ ...proposal, minConfidence, evidence, now })
        if (!checked.ok) {
            droppedCount += 1
            continue
        }
        const { field, value } = checked.value
        findings.push({
            field,
            value: value as never,
            valueKey: findingValueKey({ field, value: value as Record<string, unknown> }),
            isList: FUND_RESEARCH_FIELD_DETAILS[field].isList,
            confidence: proposal.confidence,
            sources: toSources(checked.sources),
        })
    }

    const people: PersonToSave[] = []
    for (const proposal of proposals.people) {
        const sources = quoteMentions({ quote: proposal.quote, name: proposal.name })
            ? verifyQuotedSources({ sourceUrls: proposal.sourceUrls, quote: proposal.quote, evidence })
            : null
        if (!sources) {
            droppedCount += 1
            continue
        }
        const linkedinUrl =
            proposal.linkedinUrl &&
            /linkedin\.com\/in\//i.test(proposal.linkedinUrl) &&
            verifyLink({ url: proposal.linkedinUrl, sourceUrls: proposal.sourceUrls, evidence })
                ? proposal.linkedinUrl
                : null
        people.push({
            name: proposal.name.trim(),
            nameKey: organizationNameKey({ name: proposal.name }),
            title: proposal.title?.trim() || null,
            isPrincipal: proposal.isPrincipal,
            linkedinUrl,
            email:
                proposal.email && isEmailPublished({ email: proposal.email, evidence })
                    ? proposal.email.trim().toLowerCase()
                    : null,
            bioSummary: proposal.bioSummary?.trim().slice(0, 600) || null,
            sources: toSources(sources),
        })
    }

    const affiliations: AffiliationToSave[] = []
    for (const proposal of proposals.affiliations) {
        const isAbout = quoteMentions({ quote: proposal.quote, name: proposal.organizationName })
        const sources = isAbout
            ? verifyQuotedSources({ sourceUrls: proposal.sourceUrls, quote: proposal.quote, evidence })
            : null
        const years = [proposal.startYear, proposal.endYear].filter((year): year is number => year !== null)
        if (!sources || years.some(year => year < 1950 || year > now.getUTCFullYear() + 1)) {
            droppedCount += 1
            continue
        }
        affiliations.push({
            personNameKey: organizationNameKey({ name: proposal.personName }),
            organization: {
                name: proposal.organizationName.trim(),
                nameKey: organizationNameKey({ name: proposal.organizationName }),
                kind: proposal.organizationKind,
            },
            relation: proposal.relation,
            title: proposal.title?.trim() || null,
            startYear: proposal.startYear,
            endYear: proposal.endYear,
            sources: toSources(sources),
        })
    }

    const lenders: LenderCandidate[] = []
    for (const proposal of proposals.lenders) {
        const isAbout = quoteMentions({ quote: proposal.quote, name: proposal.name })
        if (!isAbout || !verifyQuotedSources({ sourceUrls: proposal.sourceUrls, quote: proposal.quote, evidence })) {
            droppedCount += 1
            continue
        }
        lenders.push({
            type: 'named',
            name: proposal.name.trim(),
            website: proposal.website,
            context: proposal.relation,
        })
    }

    const diligence: DiligenceToSave[] = []
    for (const proposal of proposals.diligence) {
        const sources =
            proposal.confidence >= minConfidence
                ? verifyQuotedSources({ sourceUrls: proposal.sourceUrls, quote: proposal.quote, evidence })
                : null
        if (!sources || !(FUND_DILIGENCE_QUESTIONS as readonly string[]).includes(proposal.question)) {
            droppedCount += 1
            continue
        }
        diligence.push({
            question: proposal.question,
            answer: proposal.answer.trim().slice(0, 2000),
            sourceUrls: sources.map(source => source.url),
        })
    }
    return { findings, people, affiliations, lenders, diligence, droppedCount }
}

/**
 * Label a source page by what kind of source it is.
 *
 * @param input.url - The page URL.
 * @param input.fundDomain - The fund's own domain, if known.
 * @returns The source kind.
 */
export function classifySourceKind({ url, fundDomain }: { url: string; fundDomain: string | null }): FundSourceKind {
    const host = websiteDomain({ url }) ?? ''
    const isOn = (domain: string) => host === domain || host.endsWith(`.${domain}`)
    if (isOn('linkedin.com')) {
        return 'linkedin'
    }
    if (fundDomain && isOn(fundDomain)) {
        return 'fund_website'
    }
    if (DFI_DOMAINS.some(isOn)) {
        return 'dfi_database'
    }
    if (/\.gov(\.[a-z]{2})?$/.test(host) || host.endsWith('.gc.ca') || host.endsWith('.europa.eu')) {
        return 'government_database'
    }
    if (PRESS_WIRE_DOMAINS.some(isOn) || /\/(press|news-?release|media)\b/i.test(url)) {
        return 'press_release'
    }
    if (/\.pdf($|\?)/i.test(url)) {
        return 'report'
    }
    return 'news'
}

/**
 * The research request: who to research, what's already known, and what's missing.
 *
 * @param input.fundManagerId - The fund.
 * @param input.name - Its name.
 * @param input.websiteUrl - Its website, if known.
 * @param input.now - Current time.
 * @returns The prompt.
 */
async function buildResearchPrompt({
    fundManagerId,
    name,
    websiteUrl,
    now,
}: {
    fundManagerId: string
    name: string
    websiteUrl: string | null
    now: Date
}) {
    const [findings, people] = await Promise.all([
        listFundFindings({ fundManagerId }),
        listFundPeople({ fundManagerId }),
    ])
    const filled = new Set(findings.map(finding => finding.field))
    const missing = FUND_RESEARCH_FIELDS.filter(field => field !== 'public_record' && !filled.has(field))
    const known = findings
        .slice(0, 60)
        .map(finding => `- ${finding.field}: ${JSON.stringify(finding.value)}`)
        .join('\n')
    const team = people.map(person => `- ${person.name}${person.title ? `, ${person.title}` : ''}`).join('\n')
    return [
        `Research this lender: ${name}${websiteUrl ? ` (website: ${websiteUrl})` : ''}.`,
        `Today is ${now.toISOString().slice(0, 10)}.`,
        missing.length > 0
            ? `Still missing, so look for these first: ${missing.map(field => FUND_RESEARCH_FIELD_DETAILS[field as FundResearchField].label).join(', ')}.`
            : 'Every field has something; look for newer information, more deals, LPs, news and team work history.',
        known ? `Already recorded (don't record these again unless you find something newer):\n${known}` : '',
        team ? `People already recorded:\n${team}` : 'No people recorded yet: find the principals and team.',
    ]
        .filter(Boolean)
        .join('\n\n')
}

/**
 * The tools the model records its research with. Each checks the claim against what has been
 * retrieved so far and tells the model at once if it won't be kept, so it can fetch the page or quote
 * it exactly; everything is checked again when the run ends.
 *
 * @param input.proposals - Where proposals are collected (mutated).
 * @param input.evidence - What the run has retrieved so far (grows as the run goes).
 * @param input.minConfidence - Confidence floor.
 * @param input.now - Current time.
 * @returns The tools.
 */
function buildResearchTools({
    proposals,
    evidence,
    minConfidence,
    now,
}: {
    proposals: Proposals
    evidence: ResearchEvidence
    minConfidence: number
    now: Date
}): AiTool[] {
    const recorded = 'Recorded.'
    const notKept = (reason: string) =>
        `Not recorded: ${reason}. Only facts quoted word for word from a page you fetched are kept.`
    return [
        {
            name: 'record_finding',
            description:
                'Record one research fact about the lender (one deal, LP, fund raise, news item, metric, story, conference or social account per call).',
            inputSchema: z.object({
                finding: FindingInput,
                ...SourceFields,
                confidence: z.number().describe('0–1: how sure you are this is true of this lender.'),
            }),
            run: async (input: {
                finding: { field: string; value: unknown }
                source_urls: string[]
                quote: string
                confidence: number
            }) => {
                const proposal = {
                    field: input.finding.field,
                    value: input.finding.value,
                    sourceUrls: input.source_urls,
                    quote: input.quote,
                    confidence: input.confidence,
                }
                proposals.findings.push(proposal)
                const checked = verifyFinding({ ...proposal, minConfidence, evidence, now })
                return checked.ok ? recorded : notKept(checked.reason.replace(/_/g, ' '))
            },
        },
        {
            name: 'record_person',
            description: 'Record a principal or team member of the lender, from a page that names them.',
            inputSchema: z.object({
                name: z.string(),
                title: z.string().nullable(),
                is_principal: z.boolean().describe('Founder, partner, managing director, CEO or CIO.'),
                linkedin_url: z.string().nullable().describe('Their LinkedIn profile URL, only if you saw it.'),
                email: z.string().nullable().describe('Only an address the lender publishes.'),
                bio_summary: z.string().nullable().describe('One neutral sentence on their professional background.'),
                ...SourceFields,
            }),
            run: async (input: {
                name: string
                title: string | null
                is_principal: boolean
                linkedin_url: string | null
                email: string | null
                bio_summary: string | null
                source_urls: string[]
                quote: string
            }) => {
                proposals.people.push({
                    name: input.name,
                    title: input.title,
                    isPrincipal: input.is_principal,
                    linkedinUrl: input.linkedin_url,
                    email: input.email,
                    bioSummary: input.bio_summary,
                    sourceUrls: input.source_urls,
                    quote: input.quote,
                })
                const isQuoted =
                    quoteMentions({ quote: input.quote, name: input.name }) &&
                    verifyQuotedSources({ sourceUrls: input.source_urls, quote: input.quote, evidence }) !== null
                return isQuoted ? recorded : notKept('the quote must name the person and appear on a fetched page')
            },
        },
        {
            name: 'record_affiliation',
            description: "Record one of a person's past or current employers, schools or board seats.",
            inputSchema: z.object({
                person_name: z.string().describe('As recorded with record_person.'),
                organization_name: z.string(),
                organization_kind: z.enum(RESEARCH_ORGANIZATION_KINDS),
                relation: z.enum(AFFILIATION_RELATIONS),
                title: z.string().nullable(),
                start_year: z.number().int().nullable(),
                end_year: z.number().int().nullable(),
                ...SourceFields,
            }),
            run: async (input: {
                person_name: string
                organization_name: string
                organization_kind: (typeof RESEARCH_ORGANIZATION_KINDS)[number]
                relation: (typeof AFFILIATION_RELATIONS)[number]
                title: string | null
                start_year: number | null
                end_year: number | null
                source_urls: string[]
                quote: string
            }) => {
                proposals.affiliations.push({
                    personName: input.person_name,
                    organizationName: input.organization_name,
                    organizationKind: input.organization_kind,
                    relation: input.relation,
                    title: input.title,
                    startYear: input.start_year,
                    endYear: input.end_year,
                    sourceUrls: input.source_urls,
                    quote: input.quote,
                })
                const isQuoted =
                    quoteMentions({ quote: input.quote, name: input.organization_name }) &&
                    verifyQuotedSources({ sourceUrls: input.source_urls, quote: input.quote, evidence }) !== null
                return isQuoted
                    ? recorded
                    : notKept('the quote must name the organization and appear on a fetched page')
            },
        },
        {
            name: 'suggest_lender',
            description:
                'Suggest another lender to research (a co-lender, a principal’s previous fund, a lender on the same DFI list) that lends to SMEs or projects.',
            inputSchema: z.object({
                name: z.string(),
                website: z.string().nullable(),
                relation_to_fund: z
                    .string()
                    .describe('How it came up, e.g. "co-lender on the 2024 loan to Sunculture".'),
                ...SourceFields,
            }),
            run: async (input: {
                name: string
                website: string | null
                relation_to_fund: string
                source_urls: string[]
                quote: string
            }) => {
                proposals.lenders.push({
                    name: input.name,
                    website: input.website,
                    relation: input.relation_to_fund,
                    sourceUrls: input.source_urls,
                    quote: input.quote,
                })
                return 'Noted; it will be considered for research.'
            },
        },
        {
            name: 'answer_diligence',
            description: 'Answer a due diligence question, only when the lender has published the answer.',
            inputSchema: z.object({
                question: z.enum(FUND_DILIGENCE_QUESTIONS),
                answer: z.string().describe('The answer in one or two sentences, as the source states it.'),
                ...SourceFields,
                confidence: z.number(),
            }),
            run: async (input: {
                question: string
                answer: string
                source_urls: string[]
                quote: string
                confidence: number
            }) => {
                proposals.diligence.push({
                    question: input.question,
                    answer: input.answer,
                    sourceUrls: input.source_urls,
                    quote: input.quote,
                    confidence: input.confidence,
                })
                const isQuoted =
                    input.confidence >= minConfidence &&
                    verifyQuotedSources({ sourceUrls: input.source_urls, quote: input.quote, evidence }) !== null
                return isQuoted
                    ? recorded
                    : notKept('the quote was not found on a fetched page, or confidence is too low')
            },
        },
    ]
}

/**
 * Add newly retrieved pages and search results to the run's evidence.
 *
 * @param input.evidence - The evidence index (mutated).
 * @param input.pages - New pages.
 * @param input.searchResults - New search results.
 * @returns Nothing.
 */
function addEvidence({
    evidence,
    pages,
    searchResults,
}: {
    evidence: ResearchEvidence
    pages: { url: string; title: string | null; text: string }[]
    searchResults: { url: string; title: string | null }[]
}) {
    for (const page of pages) {
        evidence.pages.set(normalizeUrl({ url: page.url }), page)
    }
    for (const result of searchResults) {
        evidence.searchResults.set(normalizeUrl({ url: result.url }), result)
    }
}
