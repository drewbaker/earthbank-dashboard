import { z } from 'zod'
import { isGeoFocusCode } from '#shared/utils/geo-focus.ts'
import {
    AFFILIATION_RELATIONS,
    FUND_APPROVAL_STATUSES,
    FUND_DILIGENCE_QUESTIONS,
    FUND_FIT_SIGNAL_STATUSES,
    FUND_FIT_SIGNALS,
    FUND_FIT_TAGS,
    FUND_ORIGINS,
    FUND_RESEARCH_FIELDS,
    FUND_RESEARCH_STATUSES,
    FUND_SECTORS,
    FUND_SOURCE_KINDS,
    FUND_STAGES,
    LENDER_ARCHETYPES,
    LENDING_CHANNELS,
    LOAN_TYPES,
    TICKET_FITS,
    RESEARCH_ORGANIZATION_KINDS,
} from '#shared/constants/funds.ts'
import {
    Cents,
    CursorQuery,
    DateOnly,
    DateOnlyInput,
    IsoDateTime,
    listOf,
    queryBoolean,
    UserSummary,
} from '#shared/schemas/common.ts'

// Spider and research limits, editable in Settings → Research.
export const FundResearchSettings = z.object({
    spider_enabled: z.boolean(),
    // Start small (100); the list is meant to grow to 1,000 at most.
    max_funds: z.number().int().min(1).max(1000),
    monthly_budget_usd: z.number().min(0).max(100_000),
    max_searches_per_fund: z.number().int().min(1).max(100),
    max_fetches_per_fund: z.number().int().min(1).max(100),
    // LinkedIn profile lookups (work history) per fund through Firecrawl's data providers; 0 turns them off.
    max_profiles_per_fund: z.number().int().min(0).max(20),
    // Findings the AI is less sure of are never recorded.
    min_confidence: z.number().min(0.5).max(1),
})
export type FundResearchSettings = z.infer<typeof FundResearchSettings>

export const UpdateFundResearchSettingsRequest = FundResearchSettings.partial()
export type UpdateFundResearchSettingsRequest = z.infer<typeof UpdateFundResearchSettingsRequest>

export const FundSourceLink = z.object({
    id: z.string(),
    url: z.string(),
    title: z.string().nullable(),
    kind: z.enum(FUND_SOURCE_KINDS),
    domain: z.string(),
    quote: z.string().nullable(),
    retrieved_at: IsoDateTime,
})
export type FundSourceLink = z.infer<typeof FundSourceLink>

export const FundFinding = z.object({
    id: z.string(),
    field: z.enum(FUND_RESEARCH_FIELDS),
    // Shape depends on the field (FUND_FINDING_VALUE_SCHEMAS in shared/schemas/fund-findings.ts).
    value: z.record(z.string(), z.unknown()),
    confidence: z.number(),
    status: z.enum(['active', 'superseded', 'rejected']),
    created_at: IsoDateTime,
    sources: z.array(FundSourceLink),
})
export type FundFinding = z.infer<typeof FundFinding>

export const FundAffiliation = z.object({
    id: z.string(),
    organization: z.object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(RESEARCH_ORGANIZATION_KINDS),
        fund_id: z.string().nullable(),
    }),
    relation: z.enum(AFFILIATION_RELATIONS),
    title: z.string().nullable(),
    start_year: z.number().int().nullable(),
    end_year: z.number().int().nullable(),
    sources: z.array(FundSourceLink),
})
export type FundAffiliation = z.infer<typeof FundAffiliation>

export const FundPerson = z.object({
    id: z.string(),
    name: z.string(),
    title: z.string().nullable(),
    is_principal: z.boolean(),
    linkedin_url: z.string().nullable(),
    email: z.string().nullable(),
    bio_summary: z.string().nullable(),
    sources: z.array(FundSourceLink),
    affiliations: z.array(FundAffiliation),
})
export type FundPerson = z.infer<typeof FundPerson>

export const FundDiligenceItem = z.object({
    question: z.enum(FUND_DILIGENCE_QUESTIONS),
    answer: z.string().nullable(),
    source: z.enum(['manual', 'ai']).nullable(),
    source_urls: z.array(z.string()),
    answered_by: UserSummary.nullable(),
    // The imported note the answer came from, shown as "Note from … on …".
    note: z.object({ id: z.string(), title: z.string(), url: z.string().nullable() }).nullable(),
    updated_at: IsoDateTime.nullable(),
})
export type FundDiligenceItem = z.infer<typeof FundDiligenceItem>

export const FundResearchRun = z.object({
    id: z.string(),
    status: z.enum(['running', 'done', 'failed', 'skipped']),
    model: z.string().nullable(),
    started_at: IsoDateTime,
    finished_at: IsoDateTime.nullable(),
    web_searches: z.number().int(),
    web_fetches: z.number().int(),
    firecrawl_credits: z.number().int(),
    cost_usd: z.number(),
    findings_added: z.number().int(),
    findings_dropped: z.number().int(),
    funds_discovered: z.number().int(),
    error: z.string().nullable(),
})
export type FundResearchRun = z.infer<typeof FundResearchRun>
export const FundResearchRunList = listOf(FundResearchRun)
export type FundResearchRunList = z.infer<typeof FundResearchRunList>

// A possible website or LinkedIn page the research couldn't decide on, waiting for a person to confirm.
export const IdentityCandidate = z.object({
    kind: z.enum(['website', 'linkedin']),
    url: z.string(),
    title: z.string().nullable(),
    snippet: z.string().nullable(),
    // Why it's a candidate, e.g. "Listed on bcorporation.net", "Linked from springbankny.com".
    signals: z.array(z.string()),
})
export type IdentityCandidate = z.infer<typeof IdentityCandidate>

export const Fund = z.object({
    id: z.string(),
    name: z.string(),
    website_url: z.string().nullable(),
    linkedin_url: z.string().nullable(),
    identity_candidates: z.array(IdentityCandidate),
    stage: z.enum(FUND_STAGES),
    fit_tags: z.array(z.enum(FUND_FIT_TAGS)),
    origin: z.enum(FUND_ORIGINS),
    approval_status: z.enum(FUND_APPROVAL_STATUSES),
    // The AI screen of a spider find: one line on where and to whom it lends, and when it archived the
    // fund as outside Earth Bank's focus.
    screening_note: z.string().nullable(),
    screened_out_at: IsoDateTime.nullable(),
    // How the fund came up (spider context or the seed list's hint); helps tell funds with common names apart.
    discovery_context: z.string().nullable(),
    owner: UserSummary.nullable(),
    research_status: z.enum(FUND_RESEARCH_STATUSES),
    researched_at: IsoDateTime.nullable(),
    summary: z.string().nullable(),
    aum_cents: Cents.nullable(),
    latest_fund_size_cents: Cents.nullable(),
    last_fund_close_on: DateOnly.nullable(),
    // The newest dated public activity research found; none in 12 months suggests it may have closed.
    last_public_activity_on: DateOnly.nullable(),
    check_min_cents: Cents.nullable(),
    check_max_cents: Cents.nullable(),
    has_working_capital_loans: z.boolean(),
    max_working_capital_loan_cents: Cents.nullable(),
    year_established: z.number().int().nullable(),
    hq_country: z.string().nullable(),
    hq_city: z.string().nullable(),
    employee_count: z.number().int().nullable(),
    employee_range: z.string().nullable(),
    sectors: z.array(z.enum(FUND_SECTORS)),
    loan_types: z.array(z.enum(LOAN_TYPES)),
    focus_areas: z.array(z.string()),
    // Whether the regional focus was set by the team (else it's what research found).
    is_focus_set_by_team: z.boolean(),
    lender_archetype: z.enum(LENDER_ARCHETYPES).nullable(),
    lending_channel: z.enum(LENDING_CHANNELS).nullable(),
    lends_local_currency: z.boolean(),
    ticket_fit: z.enum(TICKET_FITS).nullable(),
    // The team's criteria for a lender worth researching; all unknown until research runs.
    fit_signals: z.record(z.enum(FUND_FIT_SIGNALS), z.enum(FUND_FIT_SIGNAL_STATUSES)),
    fit_signals_met: z.number().int(),
    research_completeness: z.number().int(),
    diligence_completeness: z.number().int(),
    archived_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
})
export type Fund = z.infer<typeof Fund>
export const FundList = listOf(Fund)
export type FundList = z.infer<typeof FundList>

// A call note (or document) imported on the fund's Import tab, and what the AI took from it.
export const FundNote = z.object({
    id: z.string(),
    title: z.string(),
    origin: z.enum(['pasted', 'google_doc']),
    doc_url: z.string().nullable(),
    author: UserSummary.nullable(),
    status: z.enum(['running', 'done', 'failed']),
    error: z.string().nullable(),
    findings_added: z.number().int(),
    people_added: z.number().int(),
    diligence_answered: z.number().int(),
    dropped: z.number().int(),
    // Answers the note gave where a person had already answered; shown so someone can update them.
    kept_existing: z.array(z.object({ question: z.enum(FUND_DILIGENCE_QUESTIONS), answer: z.string() })),
    created_at: IsoDateTime,
})
export type FundNote = z.infer<typeof FundNote>

// Either a Google Doc link or pasted text.
export const ImportFundNoteRequest = z
    .object({
        doc_url: z.string().trim().max(2000).nullish(),
        text: z.string().trim().max(200_000).nullish(),
    })
    .refine(body => Boolean(body.doc_url) !== Boolean(body.text), {
        message: 'Give a Google Doc link or paste the text (one of them).',
        path: ['text'],
    })
export type ImportFundNoteRequest = z.infer<typeof ImportFundNoteRequest>

export const FundDetail = Fund.extend({
    notes: z.string().nullable(),
    research_error: z.string().nullable(),
    approved_at: IsoDateTime.nullable(),
    approved_by: UserSummary.nullable(),
    discovered_from: z.object({ id: z.string(), name: z.string() }).nullable(),
    findings: z.array(FundFinding),
    people: z.array(FundPerson),
    diligence: z.array(FundDiligenceItem),
    imported_notes: z.array(FundNote),
    runs: z.array(FundResearchRun),
})
export type FundDetail = z.infer<typeof FundDetail>

export const FundNetwork = z.object({
    nodes: z.array(
        z.object({
            id: z.string(),
            kind: z.enum(['fund', 'person', 'organization']),
            label: z.string(),
            // The fund profile this node opens, when it has one.
            fund_id: z.string().nullable(),
            organization_kind: z.enum(RESEARCH_ORGANIZATION_KINDS).nullable(),
            is_focus: z.boolean(),
        }),
    ),
    edges: z.array(
        z.object({
            source: z.string(),
            target: z.string(),
            relation: z.enum(['team', 'employment', 'education', 'board']),
        }),
    ),
})
export type FundNetwork = z.infer<typeof FundNetwork>

export const FundResearchStatus = z.object({
    funds: z.number().int(),
    max_funds: z.number().int(),
    queued: z.number().int(),
    running: z.number().int(),
    done: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
    // Spider finds waiting for someone to approve or archive them.
    pending_approval: z.number().int(),
    archived: z.number().int(),
    month_spend_usd: z.number(),
    monthly_budget_usd: z.number(),
    spider_enabled: z.boolean(),
    is_ai_configured: z.boolean(),
})
export type FundResearchStatus = z.infer<typeof FundResearchStatus>

export const PublicInvestmentSource = z.object({
    key: z.string(),
    label: z.string(),
    publisher_kind: z.enum(['dfi', 'multilateral', 'us_government']),
    url: z.string(),
    // False for lists of mostly local lenders: their rows attach to funds on the list but add no new funds.
    feeds_spider: z.boolean(),
    status: z.enum(['idle', 'running', 'error']),
    last_synced_at: IsoDateTime.nullable(),
    records: z.number().int(),
    last_error: z.string().nullable(),
})
export type PublicInvestmentSource = z.infer<typeof PublicInvestmentSource>
export const PublicInvestmentSourceList = listOf(PublicInvestmentSource)
export type PublicInvestmentSourceList = z.infer<typeof PublicInvestmentSourceList>

const WebsiteUrl = z
    .string()
    .trim()
    .max(500)
    .refine(value => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(value), {
        message: 'Enter a full website address (https://…).',
    })

// An empty website box means "no website".
const OptionalWebsiteUrl = z.union([z.literal('').transform(() => null), WebsiteUrl]).nullable()

const LinkedinCompanyUrl = z
    .string()
    .trim()
    .max(500)
    .refine(value => /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(company|school|showcase)\/[^/?#]+/i.test(value), {
        message: 'Enter the LinkedIn company page (https://www.linkedin.com/company/…).',
    })

// An empty LinkedIn box means "not known".
const OptionalLinkedinUrl = z.union([z.literal('').transform(() => null), LinkedinCompanyUrl]).nullable()

// Name and website are needed to research a fund well; the LinkedIn page helps if the team knows it.
export const CreateFundRequest = z.object({
    name: z.string().trim().min(1).max(200),
    website_url: WebsiteUrl,
    linkedin_url: OptionalLinkedinUrl.optional(),
})
export type CreateFundRequest = z.infer<typeof CreateFundRequest>

export const UpdateFundRequest = z
    .object({
        name: z.string().trim().min(1).max(200),
        website_url: OptionalWebsiteUrl,
        linkedin_url: OptionalLinkedinUrl,
        stage: z.enum(FUND_STAGES),
        fit_tags: z.array(z.enum(FUND_FIT_TAGS)),
        notes: z.string().max(20_000).nullable(),
        owner_id: z.string().nullable(),
        // The team's regional focus (country codes, region codes, "global"); null goes back to research's.
        focus_areas: z
            .array(z.string().refine(code => isGeoFocusCode({ code }), { message: 'Unknown region or country.' }))
            .max(60)
            .nullable(),
        // "None of these": drop the website and LinkedIn candidates waiting for confirmation.
        dismiss_identity_candidates: z.boolean(),
    })
    .partial()
export type UpdateFundRequest = z.infer<typeof UpdateFundRequest>

export const AnswerDiligenceRequest = z.object({ answer: z.string().trim().min(1).max(5000) })
export type AnswerDiligenceRequest = z.infer<typeof AnswerDiligenceRequest>

// Money filters are whole US dollars, so they read naturally in a URL (?min_aum_usd=10000000).
const DollarFilter = z.coerce.number().min(0).optional()

export const ListFundsQuery = CursorQuery.extend({
    // The Funds page loads the whole list (at most 1,000) and sorts it in the browser.
    limit: z.coerce.number().int().min(1).max(1000).default(1000),
    q: z.string().trim().optional(),
    stage: z.enum(FUND_STAGES).optional(),
    sector: z.enum(FUND_SECTORS).optional(),
    loan_type: z.enum(LOAN_TYPES).optional(),
    focus_area: z.string().optional(),
    min_aum_usd: DollarFilter,
    max_aum_usd: DollarFilter,
    min_fund_size_usd: DollarFilter,
    closed_since: DateOnlyInput.optional(),
    check_size_min_usd: DollarFilter,
    check_size_max_usd: DollarFilter,
    working_capital: z.enum(['any', 'min_500k']).optional(),
    lender_archetype: z.enum(LENDER_ARCHETYPES).optional(),
    lending_channel: z.enum(LENDING_CHANNELS).optional(),
    local_currency: queryBoolean(),
    ticket_fit: z.enum(TICKET_FITS).optional(),
    min_completeness: z.coerce.number().int().min(0).max(100).optional(),
    min_fit_signals: z.coerce.number().int().min(0).max(FUND_FIT_SIGNALS.length).optional(),
    research_status: z.enum(FUND_RESEARCH_STATUSES).optional(),
    origin: z.enum(FUND_ORIGINS).optional(),
    approval_status: z.enum(FUND_APPROVAL_STATUSES).optional(),
    include_archived: queryBoolean(),
    // Only archived funds.
    archived: queryBoolean(),
})
export type ListFundsQuery = z.infer<typeof ListFundsQuery>
