import type {
    FundDiligenceAnswer as FundDiligenceAnswerRow,
    FundResearchRun as FundResearchRunRow,
    FundSource as FundSourceRow,
    User as UserRow,
} from '#server/generated/prisma/client.ts'
import type { FundListRow } from '#server/database/fund-managers.ts'
import type { FundFindingRow, FundPersonRow } from '#server/database/fund-research.ts'
import { centsToNumber, toDateOnly, toIsoDateTime } from '#server/utils/dates.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import type {
    AffiliationRelation,
    FundDiligenceQuestion,
    FundFitTag,
    FundOrigin,
    FundResearchField,
    FundResearchStatus,
    FundSector,
    FundSourceKind,
    FundStage,
    LenderArchetype,
    LendingChannel,
    LoanType,
    TicketFit,
    ResearchOrganizationKind,
} from '#shared/constants/funds.ts'
import { FUND_DILIGENCE_QUESTIONS } from '#shared/constants/funds.ts'
import type {
    Fund,
    FundDetail,
    FundDiligenceItem,
    FundFinding,
    FundPerson,
    FundResearchRun,
    FundSourceLink,
} from '#shared/schemas/index.ts'
import { IdentityCandidate } from '#shared/schemas/index.ts'
import { websiteDomain } from '#shared/funds/organization-names.ts'

/**
 * A fund as it appears in the list.
 *
 * @param input.fund - The fund row with its owner.
 * @returns The public shape.
 */
export function serializeFund({ fund }: { fund: FundListRow }): Fund {
    return {
        id: fund.id,
        name: fund.name,
        website_url: fund.website_url,
        linkedin_url: fund.linkedin_url,
        identity_candidates: identityCandidates({
            value: fund.identity_candidates,
            hasWebsite: Boolean(fund.website_url),
            hasLinkedin: Boolean(fund.linkedin_url),
        }),
        stage: fund.stage as FundStage,
        fit_tags: stringArray({ value: fund.fit_tags }) as FundFitTag[],
        origin: fund.origin as FundOrigin,
        owner: serializeUserSummary({ user: fund.owner }),
        research_status: fund.research_status as FundResearchStatus,
        researched_at: toIsoDateTime({ date: fund.researched_at }),
        summary: fund.summary,
        aum_cents: centsToNumber({ cents: fund.aum_cents }),
        latest_fund_size_cents: centsToNumber({ cents: fund.latest_fund_size_cents }),
        last_fund_close_on: toDateOnly({ date: fund.last_fund_close_on }),
        check_min_cents: centsToNumber({ cents: fund.check_min_cents }),
        check_max_cents: centsToNumber({ cents: fund.check_max_cents }),
        has_working_capital_loans: fund.has_working_capital_loans,
        max_working_capital_loan_cents: centsToNumber({ cents: fund.max_working_capital_loan_cents }),
        year_established: fund.year_established,
        hq_country: fund.hq_country,
        hq_city: fund.hq_city,
        employee_count: fund.employee_count,
        employee_range: fund.employee_range,
        sectors: stringArray({ value: fund.sectors }) as FundSector[],
        loan_types: stringArray({ value: fund.loan_types }) as LoanType[],
        focus_areas: stringArray({ value: fund.focus_areas }),
        is_focus_set_by_team: Array.isArray(fund.team_focus_areas),
        lender_archetype: fund.lender_archetype as LenderArchetype | null,
        lending_channel: fund.lending_channel as LendingChannel | null,
        lends_local_currency: fund.lends_local_currency,
        ticket_fit: fund.ticket_fit as TicketFit | null,
        research_completeness: fund.research_completeness,
        diligence_completeness: fund.diligence_completeness,
        archived_at: toIsoDateTime({ date: fund.archived_at }),
        created_at: fund.created_at.toISOString(),
    }
}

/**
 * A fund's full profile: research findings, people, diligence answers (with gaps) and recent runs.
 *
 * @param input.fund - The fund row with owner and discovered-from fund.
 * @param input.findings - Its findings with sources.
 * @param input.people - Its people with sources and affiliations.
 * @param input.answers - Its diligence answers.
 * @param input.runs - Its recent research runs.
 * @returns The public shape.
 */
export function serializeFundDetail({
    fund,
    findings,
    people,
    answers,
    runs,
}: {
    fund: FundListRow & {
        notes: string | null
        research_error: string | null
        discovery_context: string | null
        discovered_from: { id: string; name: string } | null
    }
    findings: FundFindingRow[]
    people: FundPersonRow[]
    answers: (FundDiligenceAnswerRow & { answered_by: UserRow | null })[]
    runs: FundResearchRunRow[]
}): FundDetail {
    return {
        ...serializeFund({ fund }),
        notes: fund.notes,
        research_error: fund.research_error,
        discovery_context: fund.discovery_context,
        discovered_from: fund.discovered_from ? { id: fund.discovered_from.id, name: fund.discovered_from.name } : null,
        findings: findings.map(finding => serializeFundFinding({ finding })),
        people: people.map(person => serializeFundPerson({ person })),
        diligence: serializeDiligence({ answers }),
        runs: runs.map(run => serializeFundResearchRun({ run })),
    }
}

/**
 * One research finding with its sources.
 *
 * @param input.finding - The finding row.
 * @returns The public shape.
 */
export function serializeFundFinding({ finding }: { finding: FundFindingRow }): FundFinding {
    return {
        id: finding.id,
        field: finding.field as FundResearchField,
        value: (finding.value ?? {}) as Record<string, unknown>,
        confidence: finding.confidence,
        status: finding.status as FundFinding['status'],
        created_at: finding.created_at.toISOString(),
        sources: finding.sources.map(link => serializeSourceLink({ source: link.source, quote: link.quote })),
    }
}

/**
 * One person with sources and work history.
 *
 * @param input.person - The person row.
 * @returns The public shape.
 */
export function serializeFundPerson({ person }: { person: FundPersonRow }): FundPerson {
    return {
        id: person.id,
        name: person.name,
        title: person.title,
        is_principal: person.is_principal,
        linkedin_url: person.linkedin_url,
        email: person.email,
        bio_summary: person.bio_summary,
        sources: person.sources.map(link => serializeSourceLink({ source: link.source, quote: link.quote })),
        affiliations: person.affiliations.map(affiliation => ({
            id: affiliation.id,
            organization: {
                id: affiliation.organization.id,
                name: affiliation.organization.name,
                kind: affiliation.organization.kind as ResearchOrganizationKind,
                fund_id: affiliation.organization.fund_manager_id,
            },
            relation: affiliation.relation as AffiliationRelation,
            title: affiliation.title,
            start_year: affiliation.start_year,
            end_year: affiliation.end_year,
            sources: affiliation.sources.map(link => serializeSourceLink({ source: link.source, quote: link.quote })),
        })),
    }
}

/**
 * Every diligence question, answered or not (unanswered ones are the data gaps).
 *
 * @param input.answers - Stored answers.
 * @returns One item per question, in the fixed order.
 */
export function serializeDiligence({
    answers,
}: {
    answers: (FundDiligenceAnswerRow & { answered_by: UserRow | null })[]
}): FundDiligenceItem[] {
    const byQuestion = new Map(answers.map(answer => [answer.question, answer]))
    return FUND_DILIGENCE_QUESTIONS.map((question: FundDiligenceQuestion) => {
        const answer = byQuestion.get(question)
        return {
            question,
            answer: answer?.answer ?? null,
            source: (answer?.source as 'manual' | 'ai' | undefined) ?? null,
            source_urls: stringArray({ value: answer?.source_urls }),
            answered_by: serializeUserSummary({ user: answer?.answered_by }),
            updated_at: toIsoDateTime({ date: answer?.updated_at }),
        }
    })
}

/**
 * One research run.
 *
 * @param input.run - The run row.
 * @returns The public shape.
 */
export function serializeFundResearchRun({ run }: { run: FundResearchRunRow }): FundResearchRun {
    return {
        id: run.id,
        status: run.status as FundResearchRun['status'],
        model: run.model,
        started_at: run.started_at.toISOString(),
        finished_at: toIsoDateTime({ date: run.finished_at }),
        web_searches: run.web_searches,
        web_fetches: run.web_fetches,
        firecrawl_credits: run.firecrawl_credits,
        cost_usd: run.cost_micro_usd / 1_000_000,
        findings_added: run.findings_added,
        findings_dropped: run.findings_dropped,
        funds_discovered: run.funds_discovered,
        error: run.error,
    }
}

/**
 * A source page with the quote that supports one claim.
 *
 * @param input.source - The source row.
 * @param input.quote - The supporting passage, if any.
 * @returns The public shape.
 */
function serializeSourceLink({ source, quote }: { source: FundSourceRow; quote: string | null }): FundSourceLink {
    return {
        id: source.id,
        url: source.url,
        title: source.title,
        kind: source.kind as FundSourceKind,
        domain: websiteDomain({ url: source.url }) ?? source.url,
        quote,
        retrieved_at: source.retrieved_at.toISOString(),
    }
}

/**
 * Read a JSON array column as strings.
 *
 * @param input.value - The column value.
 * @returns The strings (empty when it isn't an array).
 */
function stringArray({ value }: { value: unknown }) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * Stored identity candidates still waiting for a person: ones that no longer parse are dropped, and so
 * are a kind the fund already has (research may have found the website after the candidates were saved).
 *
 * @param input.value - The JSON column.
 * @param input.hasWebsite - Whether the fund has a website.
 * @param input.hasLinkedin - Whether the fund has a LinkedIn page.
 * @returns The candidates.
 */
function identityCandidates({
    value,
    hasWebsite,
    hasLinkedin,
}: {
    value: unknown
    hasWebsite: boolean
    hasLinkedin: boolean
}) {
    const parsed = IdentityCandidate.array().safeParse(value)
    return (parsed.success ? parsed.data : []).filter(candidate =>
        candidate.kind === 'website' ? !hasWebsite : !hasLinkedin,
    )
}
