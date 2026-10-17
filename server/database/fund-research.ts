import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'
import type { FundResearchField, FundSourceKind, ResearchOrganizationKind } from '#shared/constants/funds.ts'

type Transaction = Prisma.TransactionClient

/** A verified source to link: the page and the passage that supports the claim. */
export type SourceToLink = { url: string; title: string | null; kind: FundSourceKind; quote: string | null }

/** A verified finding ready to store. */
export type FindingToSave = {
    field: FundResearchField
    value: Prisma.InputJsonValue
    valueKey: string
    isList: boolean
    confidence: number
    sources: SourceToLink[]
}

/** A verified person ready to store. */
export type PersonToSave = {
    name: string
    nameKey: string
    title: string | null
    isPrincipal: boolean
    linkedinUrl: string | null
    email: string | null
    bioSummary: string | null
    sources: SourceToLink[]
}

/** A verified affiliation (employer, school, board seat) ready to store. */
export type AffiliationToSave = {
    personNameKey: string
    organization: { name: string; nameKey: string; kind: ResearchOrganizationKind }
    relation: 'employment' | 'education' | 'board'
    title: string | null
    startYear: number | null
    endYear: number | null
    sources: SourceToLink[]
}

/** An AI diligence answer ready to store (never over a person's answer). */
export type DiligenceToSave = { question: string; answer: string; sourceUrls: string[] }

export const FUND_FINDING_INCLUDE = {
    sources: { include: { source: true } },
} satisfies Prisma.FundFindingInclude
export type FundFindingRow = Prisma.FundFindingGetPayload<{ include: typeof FUND_FINDING_INCLUDE }>

export const FUND_PERSON_INCLUDE = {
    sources: { include: { source: true } },
    affiliations: {
        include: { organization: true, sources: { include: { source: true } } },
        orderBy: { start_year: 'desc' },
    },
} satisfies Prisma.FundPersonInclude
export type FundPersonRow = Prisma.FundPersonGetPayload<{ include: typeof FUND_PERSON_INCLUDE }>

/**
 * Store everything one research run verified, in one transaction.
 *
 * - A finding already stored with the same value just gains the new sources.
 * - A value someone rejected is never stored again.
 * - A new value for a single-value field supersedes the old one (kept as history).
 * - People and organizations are matched by normalized name; their details only fill gaps.
 * - AI diligence answers never replace a person's answer.
 *
 * @param input.fundManagerId - The fund researched.
 * @param input.researchRunId - The run that found these (null for cross-referenced public records).
 * @param input.findings - Verified findings.
 * @param input.people - Verified people.
 * @param input.affiliations - Verified affiliations.
 * @param input.diligence - Verified AI diligence answers.
 * @param input.now - Current time.
 * @returns How many new findings were stored, and the organizations affiliations point at.
 */
export function saveResearchResults({
    fundManagerId,
    researchRunId,
    findings,
    people,
    affiliations,
    diligence,
    now,
}: {
    fundManagerId: string
    researchRunId: string | null
    findings: FindingToSave[]
    people: PersonToSave[]
    affiliations: AffiliationToSave[]
    diligence: DiligenceToSave[]
    now: Date
}) {
    return db().$transaction(async tx => {
        let added = 0
        for (const finding of findings) {
            added += (await saveFinding({ tx, fundManagerId, researchRunId, finding, now })) ? 1 : 0
        }
        const personIds = new Map<string, string>()
        for (const person of people) {
            personIds.set(person.nameKey, await savePerson({ tx, fundManagerId, person, now }))
        }
        const organizationIds: string[] = []
        for (const affiliation of affiliations) {
            const personId =
                personIds.get(affiliation.personNameKey) ??
                (
                    await tx.fundPerson.findUnique({
                        where: {
                            fund_manager_id_name_key: {
                                fund_manager_id: fundManagerId,
                                name_key: affiliation.personNameKey,
                            },
                        },
                        select: { id: true },
                    })
                )?.id
            if (personId) {
                organizationIds.push(await saveAffiliation({ tx, personId, affiliation, now }))
            }
        }
        for (const answer of diligence) {
            await saveAiDiligenceAnswer({ tx, fundManagerId, answer, now })
        }
        return { added, organizationIds: [...new Set(organizationIds)] }
    })
}

/**
 * A fund's active findings with their sources (rejected and superseded ones only when asked).
 *
 * @param input.fundManagerId - The fund.
 * @param input.includeInactive - Also return rejected and superseded findings.
 * @returns Findings, oldest first.
 */
export function listFundFindings({
    fundManagerId,
    includeInactive = false,
}: {
    fundManagerId: string
    includeInactive?: boolean
}) {
    return db().fundFinding.findMany({
        where: { fund_manager_id: fundManagerId, ...(includeInactive ? {} : { status: 'active' }) },
        include: FUND_FINDING_INCLUDE,
        orderBy: { id: 'asc' },
    })
}

/**
 * Find one finding.
 *
 * @param input.findingId - The finding's id.
 * @returns The row, or null.
 */
export function findFundFinding({ findingId }: { findingId: string }) {
    return db().fundFinding.findUnique({ where: { id: findingId } })
}

/**
 * Mark a finding rejected (wrong) or restore it.
 *
 * @param input.findingId - The finding's id.
 * @param input.status - `rejected` or `active`.
 * @param input.userId - Who did it (for rejections).
 * @param input.now - Current time.
 * @returns The updated row.
 */
export function setFundFindingStatus({
    findingId,
    status,
    userId,
    now,
}: {
    findingId: string
    status: 'rejected' | 'active'
    userId: string | null
    now: Date
}) {
    return db().fundFinding.update({
        where: { id: findingId },
        data:
            status === 'rejected'
                ? { status, rejected_by_user_id: userId, rejected_at: now }
                : { status, rejected_by_user_id: null, rejected_at: null },
    })
}

/**
 * Supersede the other active findings of a single-value field (after restoring one).
 *
 * @param input.fundManagerId - The fund.
 * @param input.field - The field.
 * @param input.keepFindingId - The finding that stays active.
 * @returns The update count.
 */
export function supersedeOtherFindings({
    fundManagerId,
    field,
    keepFindingId,
}: {
    fundManagerId: string
    field: string
    keepFindingId: string
}) {
    return db().fundFinding.updateMany({
        where: { fund_manager_id: fundManagerId, field, status: 'active', id: { not: keepFindingId } },
        data: { status: 'superseded' },
    })
}

/**
 * A fund's people with their sources and affiliations.
 *
 * @param input.fundManagerId - The fund.
 * @returns People, principals first.
 */
export function listFundPeople({ fundManagerId }: { fundManagerId: string }) {
    return db().fundPerson.findMany({
        where: { fund_manager_id: fundManagerId },
        include: FUND_PERSON_INCLUDE,
        orderBy: [{ is_principal: 'desc' }, { name: 'asc' }],
    })
}

/**
 * Whether a fund has a known principal and any team work history (for completeness).
 *
 * @param input.fundManagerId - The fund.
 * @returns The two flags.
 */
export async function readFundTeamCoverage({ fundManagerId }: { fundManagerId: string }) {
    const [principals, affiliations] = await Promise.all([
        db().fundPerson.count({ where: { fund_manager_id: fundManagerId, is_principal: true } }),
        db().fundAffiliation.count({ where: { person: { fund_manager_id: fundManagerId } } }),
    ])
    return { hasPrincipals: principals > 0, hasWorkHistory: affiliations > 0 }
}

/**
 * The network around one fund: its people, their organizations, and other funds' people at those
 * same organizations.
 *
 * @param input.fundManagerId - The fund at the center.
 * @returns People (with affiliations) of this fund, and other funds' affiliations at shared organizations.
 */
export async function readFundNetworkRows({ fundManagerId }: { fundManagerId: string }) {
    const people = await db().fundPerson.findMany({
        where: { fund_manager_id: fundManagerId },
        include: { affiliations: { include: { organization: true } } },
    })
    const organizationIds = [
        ...new Set(people.flatMap(person => person.affiliations.map(affiliation => affiliation.organization_id))),
    ]
    const sharedAffiliations = await db().fundAffiliation.findMany({
        where: { organization_id: { in: organizationIds }, person: { fund_manager_id: { not: fundManagerId } } },
        include: { person: { include: { fund_manager: { select: { id: true, name: true } } } } },
        take: 300,
    })
    return { people, sharedAffiliations }
}

/**
 * A fund's diligence answers.
 *
 * @param input.fundManagerId - The fund.
 * @returns Answers with who gave them.
 */
export function listFundDiligenceAnswers({ fundManagerId }: { fundManagerId: string }) {
    return db().fundDiligenceAnswer.findMany({
        where: { fund_manager_id: fundManagerId },
        include: { answered_by: true },
    })
}

/**
 * Save a person's diligence answer (always wins over an AI answer).
 *
 * @param input.fundManagerId - The fund.
 * @param input.question - Question key.
 * @param input.answer - The answer text.
 * @param input.userId - Who answered.
 * @returns The stored row.
 */
export function saveManualDiligenceAnswer({
    fundManagerId,
    question,
    answer,
    userId,
}: {
    fundManagerId: string
    question: string
    answer: string
    userId: string
}) {
    return db().fundDiligenceAnswer.upsert({
        where: { fund_manager_id_question: { fund_manager_id: fundManagerId, question } },
        create: {
            id: newId({ kind: 'fundDiligenceAnswer' }),
            fund_manager_id: fundManagerId,
            question,
            answer,
            source: 'manual',
            answered_by_user_id: userId,
        },
        update: { answer, source: 'manual', source_urls: [], answered_by_user_id: userId },
    })
}

/**
 * Clear a diligence answer.
 *
 * @param input.fundManagerId - The fund.
 * @param input.question - Question key.
 * @returns The delete count.
 */
export function deleteDiligenceAnswer({ fundManagerId, question }: { fundManagerId: string; question: string }) {
    return db().fundDiligenceAnswer.deleteMany({ where: { fund_manager_id: fundManagerId, question } })
}

/**
 * Start a research run (a fund's research, a public list read, or a spider classification batch).
 *
 * @param input.kind - What the run is for.
 * @param input.fundManagerId - The fund, for fund runs and classifications triggered by one.
 * @param input.sourceKey - The public list, for list runs.
 * @param input.model - Model id.
 * @param input.now - Start time.
 * @returns The run row.
 */
export function createFundResearchRun({
    kind = 'fund',
    fundManagerId = null,
    sourceKey = null,
    model,
    now,
}: {
    kind?: 'fund' | 'public_list' | 'classification'
    fundManagerId?: string | null
    sourceKey?: string | null
    model: string | null
    now: Date
}) {
    return db().fundResearchRun.create({
        data: {
            id: newId({ kind: 'fundResearchRun', now: now.getTime() }),
            kind,
            fund_manager_id: fundManagerId,
            source_key: sourceKey,
            model,
            started_at: now,
        },
    })
}

/**
 * Finish a research run with its counts.
 *
 * @param input.researchRunId - The run.
 * @param input.data - Status, usage and counts.
 * @returns The updated row.
 */
export function finishFundResearchRun({
    researchRunId,
    data,
}: {
    researchRunId: string
    data: Prisma.FundResearchRunUncheckedUpdateInput
}) {
    return db().fundResearchRun.update({ where: { id: researchRunId }, data })
}

/**
 * A fund's recent research runs.
 *
 * @param input.fundManagerId - The fund.
 * @param input.limit - Most rows.
 * @returns Runs, newest first.
 */
export function listFundResearchRuns({ fundManagerId, limit }: { fundManagerId: string; limit: number }) {
    return db().fundResearchRun.findMany({
        where: { fund_manager_id: fundManagerId, kind: 'fund' },
        orderBy: { id: 'desc' },
        take: limit,
    })
}

/**
 * What research (and spider classification) has cost since a date, in micro-dollars.
 *
 * @param input.since - Start of the period (e.g. the first of the month, UTC).
 * @returns Total cost in millionths of a dollar.
 */
export async function sumResearchCostSince({ since }: { since: Date }) {
    const result = await db().fundResearchRun.aggregate({
        where: { started_at: { gte: since } },
        _sum: { cost_micro_usd: true },
    })
    return result._sum.cost_micro_usd ?? 0
}

/**
 * Organizations nobody has checked yet for whether they are lenders (spider candidates).
 *
 * @param input.organizationIds - Organizations to consider.
 * @returns Unclassified organizations without a fund profile.
 */
export function listUnclassifiedOrganizations({ organizationIds }: { organizationIds: string[] }) {
    return db().researchOrganization.findMany({
        where: { id: { in: organizationIds }, classified_at: null, fund_manager_id: null },
    })
}

/**
 * Record whether an organization is a lender, and link its fund profile when it has one.
 *
 * @param input.organizationId - The organization.
 * @param input.kind - Its kind.
 * @param input.fundManagerId - Its fund profile, if created or found.
 * @param input.now - Current time.
 * @returns The updated row.
 */
export function markOrganizationClassified({
    organizationId,
    kind,
    fundManagerId,
    now,
}: {
    organizationId: string
    kind: ResearchOrganizationKind
    fundManagerId: string | null
    now: Date
}) {
    return db().researchOrganization.update({
        where: { id: organizationId },
        data: { kind, fund_manager_id: fundManagerId, classified_at: now },
    })
}

/**
 * Link the organization node with this name to a fund profile (so graphs open the profile).
 *
 * @param input.nameKey - Normalized name.
 * @param input.fundManagerId - The fund profile.
 * @returns The update count.
 */
export function linkOrganizationToFund({ nameKey, fundManagerId }: { nameKey: string; fundManagerId: string }) {
    return db().researchOrganization.updateMany({
        where: { name_key: nameKey, fund_manager_id: null },
        data: { fund_manager_id: fundManagerId, kind: 'lender' },
    })
}

/**
 * Store one finding (see saveResearchResults for the rules).
 *
 * @param input.tx - Transaction client.
 * @param input.fundManagerId - The fund.
 * @param input.researchRunId - The run.
 * @param input.finding - The finding.
 * @param input.now - Current time.
 * @returns True when a new finding row became active.
 */
async function saveFinding({
    tx,
    fundManagerId,
    researchRunId,
    finding,
    now,
}: {
    tx: Transaction
    fundManagerId: string
    researchRunId: string | null
    finding: FindingToSave
    now: Date
}) {
    const existing = await tx.fundFinding.findFirst({
        where: { fund_manager_id: fundManagerId, field: finding.field, value_key: finding.valueKey },
        orderBy: { id: 'desc' },
    })
    if (existing?.status === 'rejected') {
        return false
    }
    let findingId = existing?.id
    if (!existing) {
        const created = await tx.fundFinding.create({
            data: {
                id: newId({ kind: 'fundFinding', now: now.getTime() }),
                fund_manager_id: fundManagerId,
                field: finding.field,
                value: finding.value,
                value_key: finding.valueKey,
                confidence: finding.confidence,
                research_run_id: researchRunId,
            },
        })
        findingId = created.id
    } else if (existing.status === 'superseded' || finding.confidence > existing.confidence) {
        await tx.fundFinding.update({
            where: { id: existing.id },
            data: {
                status: 'active',
                value: finding.value,
                confidence: Math.max(existing.confidence, finding.confidence),
            },
        })
    }
    if (!finding.isList && findingId) {
        await tx.fundFinding.updateMany({
            where: { fund_manager_id: fundManagerId, field: finding.field, status: 'active', id: { not: findingId } },
            data: { status: 'superseded' },
        })
    }
    for (const source of finding.sources) {
        const sourceId = await upsertSource({ tx, source, now })
        await tx.fundFindingSource.upsert({
            where: { finding_id_source_id: { finding_id: findingId!, source_id: sourceId } },
            create: { finding_id: findingId!, source_id: sourceId, quote: source.quote },
            update: {},
        })
    }
    return !existing || existing.status === 'superseded'
}

/**
 * Store or update one person; new details only fill empty ones (a principal stays a principal).
 *
 * @param input.tx - Transaction client.
 * @param input.fundManagerId - The fund.
 * @param input.person - The person.
 * @param input.now - Current time.
 * @returns The person's id.
 */
async function savePerson({
    tx,
    fundManagerId,
    person,
    now,
}: {
    tx: Transaction
    fundManagerId: string
    person: PersonToSave
    now: Date
}) {
    const existing = await tx.fundPerson.findUnique({
        where: { fund_manager_id_name_key: { fund_manager_id: fundManagerId, name_key: person.nameKey } },
    })
    const row = existing
        ? await tx.fundPerson.update({
              where: { id: existing.id },
              data: {
                  title: existing.title ?? person.title,
                  is_principal: existing.is_principal || person.isPrincipal,
                  linkedin_url: existing.linkedin_url ?? person.linkedinUrl,
                  email: existing.email ?? person.email,
                  bio_summary: existing.bio_summary ?? person.bioSummary,
              },
          })
        : await tx.fundPerson.create({
              data: {
                  id: newId({ kind: 'fundPerson', now: now.getTime() }),
                  fund_manager_id: fundManagerId,
                  name: person.name,
                  name_key: person.nameKey,
                  title: person.title,
                  is_principal: person.isPrincipal,
                  linkedin_url: person.linkedinUrl,
                  email: person.email,
                  bio_summary: person.bioSummary,
              },
          })
    for (const source of person.sources) {
        const sourceId = await upsertSource({ tx, source, now })
        await tx.fundPersonSource.upsert({
            where: { person_id_source_id: { person_id: row.id, source_id: sourceId } },
            create: { person_id: row.id, source_id: sourceId, quote: source.quote },
            update: {},
        })
    }
    return row.id
}

/**
 * Store one affiliation, creating the organization node if it's new.
 *
 * @param input.tx - Transaction client.
 * @param input.personId - The person.
 * @param input.affiliation - The affiliation.
 * @param input.now - Current time.
 * @returns The organization's id.
 */
async function saveAffiliation({
    tx,
    personId,
    affiliation,
    now,
}: {
    tx: Transaction
    personId: string
    affiliation: AffiliationToSave
    now: Date
}) {
    const organization = await tx.researchOrganization.upsert({
        where: { name_key: affiliation.organization.nameKey },
        create: {
            id: newId({ kind: 'researchOrganization', now: now.getTime() }),
            name: affiliation.organization.name,
            name_key: affiliation.organization.nameKey,
            kind: affiliation.organization.kind,
        },
        update: {},
    })
    const row = await tx.fundAffiliation.upsert({
        where: {
            person_id_organization_id_relation: {
                person_id: personId,
                organization_id: organization.id,
                relation: affiliation.relation,
            },
        },
        create: {
            id: newId({ kind: 'fundAffiliation', now: now.getTime() }),
            person_id: personId,
            organization_id: organization.id,
            relation: affiliation.relation,
            title: affiliation.title,
            start_year: affiliation.startYear,
            end_year: affiliation.endYear,
        },
        update: {},
    })
    for (const source of affiliation.sources) {
        const sourceId = await upsertSource({ tx, source, now })
        await tx.fundAffiliationSource.upsert({
            where: { affiliation_id_source_id: { affiliation_id: row.id, source_id: sourceId } },
            create: { affiliation_id: row.id, source_id: sourceId, quote: source.quote },
            update: {},
        })
    }
    return organization.id
}

/**
 * Store an AI diligence answer unless a person already answered.
 *
 * @param input.tx - Transaction client.
 * @param input.fundManagerId - The fund.
 * @param input.answer - The answer.
 * @param input.now - Current time.
 * @returns Nothing.
 */
async function saveAiDiligenceAnswer({
    tx,
    fundManagerId,
    answer,
    now,
}: {
    tx: Transaction
    fundManagerId: string
    answer: DiligenceToSave
    now: Date
}) {
    const existing = await tx.fundDiligenceAnswer.findUnique({
        where: { fund_manager_id_question: { fund_manager_id: fundManagerId, question: answer.question } },
    })
    if (existing?.source === 'manual') {
        return
    }
    await tx.fundDiligenceAnswer.upsert({
        where: { fund_manager_id_question: { fund_manager_id: fundManagerId, question: answer.question } },
        create: {
            id: newId({ kind: 'fundDiligenceAnswer', now: now.getTime() }),
            fund_manager_id: fundManagerId,
            question: answer.question,
            answer: answer.answer,
            source: 'ai',
            source_urls: answer.sourceUrls,
        },
        update: { answer: answer.answer, source_urls: answer.sourceUrls },
    })
}

/**
 * Store a source page once per URL.
 *
 * @param input.tx - Transaction client.
 * @param input.source - The page.
 * @param input.now - When it was retrieved.
 * @returns The source's id.
 */
async function upsertSource({ tx, source, now }: { tx: Transaction; source: SourceToLink; now: Date }) {
    const row = await tx.fundSource.upsert({
        where: { url: source.url },
        create: {
            id: newId({ kind: 'fundSource', now: now.getTime() }),
            url: source.url,
            title: source.title,
            kind: source.kind,
            retrieved_at: now,
        },
        update: { retrieved_at: now, ...(source.title ? { title: source.title } : {}) },
    })
    return row.id
}
