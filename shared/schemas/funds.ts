import { z } from 'zod'
import {
    AFFILIATION_RELATIONS,
    FUND_DILIGENCE_QUESTIONS,
    FUND_FIT_TAGS,
    FUND_ORIGINS,
    FUND_RESEARCH_FIELDS,
    FUND_RESEARCH_STATUSES,
    FUND_SECTORS,
    FUND_SOURCE_KINDS,
    FUND_STAGES,
    LOAN_TYPES,
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

export const Fund = z.object({
    id: z.string(),
    name: z.string(),
    website_url: z.string().nullable(),
    linkedin_url: z.string().nullable(),
    stage: z.enum(FUND_STAGES),
    fit_tags: z.array(z.enum(FUND_FIT_TAGS)),
    origin: z.enum(FUND_ORIGINS),
    owner: UserSummary.nullable(),
    research_status: z.enum(FUND_RESEARCH_STATUSES),
    researched_at: IsoDateTime.nullable(),
    summary: z.string().nullable(),
    aum_cents: Cents.nullable(),
    latest_fund_size_cents: Cents.nullable(),
    last_fund_close_on: DateOnly.nullable(),
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
    research_completeness: z.number().int(),
    diligence_completeness: z.number().int(),
    archived_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
})
export type Fund = z.infer<typeof Fund>
export const FundList = listOf(Fund)
export type FundList = z.infer<typeof FundList>

export const FundDetail = Fund.extend({
    notes: z.string().nullable(),
    research_error: z.string().nullable(),
    discovered_from: z.object({ id: z.string(), name: z.string() }).nullable(),
    findings: z.array(FundFinding),
    people: z.array(FundPerson),
    diligence: z.array(FundDiligenceItem),
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
    min_completeness: z.coerce.number().int().min(0).max(100).optional(),
    research_status: z.enum(FUND_RESEARCH_STATUSES).optional(),
    origin: z.enum(FUND_ORIGINS).optional(),
    include_archived: queryBoolean(),
})
export type ListFundsQuery = z.infer<typeof ListFundsQuery>
