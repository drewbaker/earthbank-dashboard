import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'
import type { FundResearchValues } from '#server/utils/funds/research-values.ts'
import type { FundApprovalStatus, FundOrigin, FundResearchStatus } from '#shared/constants/funds.ts'
import { GLOBAL_FOCUS } from '#shared/constants/regions.ts'
import { countriesInFocus } from '#shared/utils/geo-focus.ts'

export const FUND_LIST_INCLUDE = { owner: true } satisfies Prisma.FundManagerInclude
export type FundListRow = Prisma.FundManagerGetPayload<{ include: typeof FUND_LIST_INCLUDE }>

/** Filters for the fund list; every one is optional. Money filters are US cents. */
export type FundListFilters = {
    search?: string
    stage?: string
    sector?: string
    loanType?: string
    focusArea?: string
    minAumCents?: bigint
    maxAumCents?: bigint
    minFundSizeCents?: bigint
    closedSince?: Date
    checkSizeMinCents?: bigint
    checkSizeMaxCents?: bigint
    minWorkingCapitalCents?: bigint
    requireWorkingCapital?: boolean
    minCompleteness?: number
    lenderArchetype?: string
    lendingChannel?: string
    requireLocalCurrency?: boolean
    ticketFit?: string
    researchStatus?: string
    origin?: string
    approvalStatus?: FundApprovalStatus
    includeArchived?: boolean
    // Only archived funds (the Archived list).
    archivedOnly?: boolean
    limit: number
}

/**
 * Create a fund profile.
 *
 * @param input.name - Display name.
 * @param input.nameKey - De-duplication key (organizationNameKey).
 * @param input.websiteUrl - Website, if known.
 * @param input.websiteDomain - Bare host of the website, if known.
 * @param input.linkedinUrl - LinkedIn company page, if known.
 * @param input.discoveryContext - How the fund came up, or a region hint.
 * @param input.origin - How it got onto the list.
 * @param input.discoveredFromId - The fund whose research turned it up, if any.
 * @param input.approvalStatus - `pending` waits for someone to approve it before any research.
 * @param input.approvedById - Who added it, when it is approved on creation.
 * @param input.screening - The AI screen of a spider find: its reason, and whether it fits Earth Bank
 *   (when not, the fund is created archived).
 * @param input.now - Creation time (also when research was queued).
 * @returns The created row.
 */
export function createFundManagerRow({
    name,
    nameKey,
    websiteUrl,
    websiteDomain,
    linkedinUrl = null,
    discoveryContext = null,
    origin,
    discoveredFromId,
    approvalStatus,
    approvedById = null,
    screening = null,
    now,
}: {
    name: string
    nameKey: string
    websiteUrl: string | null
    websiteDomain: string | null
    linkedinUrl?: string | null
    discoveryContext?: string | null
    origin: FundOrigin
    discoveredFromId: string | null
    approvalStatus: FundApprovalStatus
    approvedById?: string | null
    screening?: { note: string | null; fitsEarthBank: boolean } | null
    now: Date
}) {
    const isApproved = approvalStatus === 'approved'
    const isScreenedOut = screening?.fitsEarthBank === false
    return db().fundManager.create({
        data: {
            id: newId({ kind: 'fundManager', now: now.getTime() }),
            name,
            name_key: nameKey,
            website_url: websiteUrl,
            website_domain: websiteDomain,
            linkedin_url: linkedinUrl,
            discovery_context: discoveryContext,
            origin,
            discovered_from_id: discoveredFromId,
            approval_status: approvalStatus,
            approved_at: isApproved ? now : null,
            approved_by_id: isApproved ? approvedById : null,
            research_status: isApproved ? 'queued' : 'awaiting_approval',
            research_queued_at: isApproved ? now : null,
            screened_at: screening ? now : null,
            screening_note: screening?.note ?? null,
            screened_out_at: isScreenedOut ? now : null,
            archived_at: isScreenedOut ? now : null,
        },
    })
}

/**
 * Find one fund (archived included).
 *
 * @param input.fundManagerId - The fund's id.
 * @returns The row, or null.
 */
export function findFundManager({ fundManagerId }: { fundManagerId: string }) {
    return db().fundManager.findUnique({
        where: { id: fundManagerId },
        include: { owner: true, approved_by: true, discovered_from: true },
    })
}

/**
 * Find a fund that is already on the list under the same name key or website domain.
 *
 * @param input.nameKey - Normalized name.
 * @param input.websiteDomain - Bare host, if known.
 * @returns The existing row, or null.
 */
export function findFundManagerByIdentity({
    nameKey,
    websiteDomain,
}: {
    nameKey: string
    websiteDomain: string | null
}) {
    return db().fundManager.findFirst({
        where: { OR: [{ name_key: nameKey }, ...(websiteDomain ? [{ website_domain: websiteDomain }] : [])] },
    })
}

/**
 * Find the fund that uses a website domain.
 *
 * @param input.websiteDomain - Bare host.
 * @returns The row, or null.
 */
export function findFundManagerByDomain({ websiteDomain }: { websiteDomain: string }) {
    return db().fundManager.findUnique({ where: { website_domain: websiteDomain } })
}

/**
 * List funds matching the filters, with owners, newest first (the page sorts on its own).
 *
 * JSON-array filters (sector, loan type, focus area) are applied after the query: the list is at
 * most 1,000 funds, and SQLite JSON filtering through Prisma is limited.
 *
 * @param input - Filters (see FundListFilters).
 * @returns Up to `limit` rows.
 */
export async function listFundManagers({
    search,
    stage,
    sector,
    loanType,
    focusArea,
    minAumCents,
    maxAumCents,
    minFundSizeCents,
    closedSince,
    checkSizeMinCents,
    checkSizeMaxCents,
    minWorkingCapitalCents,
    requireWorkingCapital,
    minCompleteness,
    lenderArchetype,
    lendingChannel,
    requireLocalCurrency,
    ticketFit,
    researchStatus,
    origin,
    approvalStatus,
    includeArchived,
    archivedOnly,
    limit,
}: FundListFilters) {
    const and: Prisma.FundManagerWhereInput[] = []
    if (search) {
        and.push({
            OR: [
                { name: { contains: search } },
                { summary: { contains: search } },
                { website_url: { contains: search } },
            ],
        })
    }
    if (minAumCents !== undefined || maxAumCents !== undefined) {
        and.push({ aum_cents: { gte: minAumCents, lte: maxAumCents } })
    }
    if (minFundSizeCents !== undefined) {
        and.push({ latest_fund_size_cents: { gte: minFundSizeCents } })
    }
    if (closedSince) {
        and.push({ last_fund_close_on: { gte: closedSince } })
    }
    // A fund matches a check-size range when its own range overlaps it.
    if (checkSizeMinCents !== undefined) {
        and.push({
            OR: [
                { check_max_cents: { gte: checkSizeMinCents } },
                { check_max_cents: null, check_min_cents: { gte: checkSizeMinCents } },
            ],
        })
    }
    if (checkSizeMaxCents !== undefined) {
        and.push({
            OR: [
                { check_min_cents: { lte: checkSizeMaxCents } },
                { check_min_cents: null, check_max_cents: { lte: checkSizeMaxCents } },
            ],
        })
    }
    if (requireWorkingCapital) {
        and.push({ has_working_capital_loans: true })
    }
    if (minWorkingCapitalCents !== undefined) {
        and.push({ max_working_capital_loan_cents: { gte: minWorkingCapitalCents } })
    }
    if (minCompleteness !== undefined) {
        and.push({ research_completeness: { gte: minCompleteness } })
    }
    const rows = await db().fundManager.findMany({
        where: {
            AND: and,
            stage,
            lender_archetype: lenderArchetype,
            lending_channel: lendingChannel,
            ticket_fit: ticketFit,
            ...(requireLocalCurrency ? { lends_local_currency: true } : {}),
            research_status: researchStatus,
            origin,
            approval_status: approvalStatus,
            archived_at: archivedOnly ? { not: null } : includeArchived ? undefined : null,
        },
        include: FUND_LIST_INCLUDE,
        orderBy: { id: 'desc' },
    })
    const hasCode = (column: unknown, code: string | undefined) =>
        code === undefined || (Array.isArray(column) && column.includes(code))
    const focusCountries = focusArea ? countriesInFocus({ codes: [focusArea] }) : null
    // A region filter matches funds focused on any country in it (and global funds).
    const coversFocus = (column: unknown) => {
        if (!focusArea) {
            return true
        }
        const codes = Array.isArray(column) ? (column as string[]) : []
        if (codes.includes(focusArea) || codes.includes(GLOBAL_FOCUS)) {
            return true
        }
        const fundCountries = countriesInFocus({ codes })
        return [...(focusCountries ?? [])].some(country => fundCountries.has(country))
    }
    return rows
        .filter(
            row => hasCode(row.sectors, sector) && hasCode(row.loan_types, loanType) && coversFocus(row.focus_areas),
        )
        .slice(0, limit)
}

/**
 * Update a fund's own columns (team fields and research state; not findings).
 *
 * @param input.fundManagerId - The fund's id.
 * @param input.data - Columns to set.
 * @returns The updated row.
 */
export function updateFundManagerColumns({
    fundManagerId,
    data,
}: {
    fundManagerId: string
    data: Prisma.FundManagerUncheckedUpdateInput
}) {
    return db().fundManager.update({ where: { id: fundManagerId }, data })
}

/**
 * Store a fund's recomputed research values.
 *
 * @param input.fundManagerId - The fund's id.
 * @param input.values - Values from deriveFundResearchValues.
 * @param input.diligenceCompleteness - 0–100.
 * @returns The updated row.
 */
export function storeFundResearchValues({
    fundManagerId,
    values,
    diligenceCompleteness,
}: {
    fundManagerId: string
    values: FundResearchValues
    diligenceCompleteness: number
}) {
    return db().fundManager.update({
        where: { id: fundManagerId },
        data: { ...values, diligence_completeness: diligenceCompleteness },
    })
}

/**
 * Set a fund's research status.
 *
 * @param input.fundManagerId - The fund's id.
 * @param input.status - New status.
 * @param input.error - Error text for `failed`, else cleared.
 * @param input.now - Current time (stamps queued/done times).
 * @returns The updated row.
 */
export function setFundResearchStatus({
    fundManagerId,
    status,
    error = null,
    now,
}: {
    fundManagerId: string
    status: FundResearchStatus
    error?: string | null
    now: Date
}) {
    return db().fundManager.update({
        where: { id: fundManagerId },
        data: {
            research_status: status,
            research_error: error,
            ...(status === 'queued' ? { research_queued_at: now } : {}),
            ...(status === 'done' ? { researched_at: now } : {}),
        },
    })
}

/**
 * How many funds are on the list (archived ones don't count toward the limit).
 *
 * @returns The count.
 */
export function countActiveFundManagers() {
    return db().fundManager.count({ where: { archived_at: null } })
}

/**
 * How many funds the spider found are waiting for someone to approve or archive them.
 *
 * @returns The count.
 */
export function countPendingFundManagers() {
    return db().fundManager.count({ where: { archived_at: null, approval_status: 'pending' } })
}

/**
 * How many funds are archived (by a person, or screened out by the AI).
 *
 * @returns The count.
 */
export function countArchivedFundManagers() {
    return db().fundManager.count({ where: { archived_at: { not: null } } })
}

/**
 * Pending funds the AI hasn't screened yet (found before the screen existed, or its screen failed).
 *
 * @param input.limit - Most rows.
 * @returns The funds, oldest first.
 */
export function listUnscreenedPendingFunds({ limit }: { limit: number }) {
    return db().fundManager.findMany({
        where: { approval_status: 'pending', archived_at: null, screened_at: null },
        select: { id: true, name: true, name_key: true, website_url: true, discovery_context: true },
        orderBy: { id: 'asc' },
        take: limit,
    })
}

/**
 * Store the AI screen of a pending fund, archiving it when it doesn't fit Earth Bank.
 *
 * @param input.fundManagerId - The fund.
 * @param input.note - The model's one-line reason.
 * @param input.isScreenedOut - Archive it as outside Earth Bank's focus.
 * @param input.now - Current time.
 * @returns The updated row.
 */
export function recordFundScreening({
    fundManagerId,
    note,
    isScreenedOut,
    now,
}: {
    fundManagerId: string
    note: string | null
    isScreenedOut: boolean
    now: Date
}) {
    return db().fundManager.update({
        where: { id: fundManagerId },
        data: {
            screened_at: now,
            screening_note: note,
            ...(isScreenedOut ? { screened_out_at: now, archived_at: now } : {}),
        },
    })
}

/**
 * The team's own recent decisions on funds the spider found, as examples for the classifier: funds a
 * person approved, and funds a person archived while they were pending (not ones the AI screened out,
 * which nobody has confirmed).
 *
 * @param input.limit - Most of each.
 * @returns Approved and archived funds, newest decisions first.
 */
export async function listTeamFundDecisions({ limit }: { limit: number }) {
    const spiderFound = { origin: { startsWith: 'spider_' } }
    const select = { name: true, discovery_context: true }
    const [approved, archived] = await Promise.all([
        db().fundManager.findMany({
            where: { ...spiderFound, approval_status: 'approved', approved_by_id: { not: null } },
            select,
            orderBy: { approved_at: 'desc' },
            take: limit,
        }),
        db().fundManager.findMany({
            where: {
                ...spiderFound,
                approval_status: 'pending',
                archived_at: { not: null },
                screened_out_at: null,
            },
            select,
            orderBy: { archived_at: 'desc' },
            take: limit,
        }),
    ])
    return { approved, archived }
}

/**
 * Mark a pending fund approved.
 *
 * Only a pending fund changes, so two people approving at once both see it approved and it's
 * recorded once.
 *
 * @param input.fundManagerId - The fund's id.
 * @param input.approvedById - Who approved it.
 * @param input.now - Approval time.
 * @returns Whether this call approved it (false when it was already approved).
 */
export async function approveFundManager({
    fundManagerId,
    approvedById,
    now,
}: {
    fundManagerId: string
    approvedById: string
    now: Date
}) {
    const { count } = await db().fundManager.updateMany({
        where: { id: fundManagerId, approval_status: 'pending' },
        data: { approval_status: 'approved', approved_at: now, approved_by_id: approvedById },
    })
    return count > 0
}

/**
 * Count funds per research status.
 *
 * @returns Status → count.
 */
export async function countFundsByResearchStatus() {
    const groups = await db().fundManager.groupBy({
        by: ['research_status'],
        where: { archived_at: null },
        _count: { _all: true },
    })
    return Object.fromEntries(groups.map(group => [group.research_status, group._count._all])) as Partial<
        Record<FundResearchStatus, number>
    >
}

/**
 * Funds whose research should be (re)queued: waiting, stuck running since before a cutoff, or paused.
 *
 * Seeds and team-added funds come first, then the rest in the order they were found.
 *
 * @param input.staleBefore - Running or queued since before this means the job was lost (e.g. a deploy).
 * @param input.limit - Most rows.
 * @returns Fund ids and origins.
 */
export async function listFundsNeedingResearch({ staleBefore, limit }: { staleBefore: Date; limit: number }) {
    const rows = await db().fundManager.findMany({
        where: {
            archived_at: null,
            approval_status: 'approved',
            OR: [
                { research_status: 'skipped' },
                {
                    research_status: { in: ['queued', 'running'] },
                    OR: [{ research_queued_at: null }, { research_queued_at: { lt: staleBefore } }],
                },
            ],
        },
        select: { id: true, origin: true },
        orderBy: { id: 'asc' },
        take: limit,
    })
    return rows.sort(
        (a, b) => Number(isPriorityOrigin({ origin: b.origin })) - Number(isPriorityOrigin({ origin: a.origin })),
    )
}

/**
 * Whether research for this origin goes ahead of spidered funds.
 *
 * @param input.origin - The fund's origin.
 * @returns True for seeds and funds the team added.
 */
export function isPriorityOrigin({ origin }: { origin: string }) {
    return origin === 'seed' || origin === 'manual'
}

/**
 * Names and websites of every fund, for de-duplicating spider candidates.
 *
 * @returns Id, name key and domain per fund.
 */
export function listFundIdentities() {
    return db().fundManager.findMany({ select: { id: true, name_key: true, website_domain: true } })
}
