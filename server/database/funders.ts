import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'
import type { FunderKind, FunderStatus, FunderTier, GoalType, RelationshipStatus } from '#shared/constants/pipeline.ts'

// What every funder read includes: owner and live opportunities (for totals and goal badges).
export const FUNDER_SUMMARY_INCLUDE = {
    owner: true,
    opportunities: { where: { archived_at: null }, include: { goal: true } },
} satisfies Prisma.FunderInclude

export type FunderSummaryRow = Prisma.FunderGetPayload<{ include: typeof FUNDER_SUMMARY_INCLUDE }>

/**
 * Create a funder.
 *
 * @param input.name - Organization name.
 * @param input.nameKey - Normalized name used for de-duplication.
 * @param input.kind - Kind of organization.
 * @param input.tier - Priority tier, if known.
 * @param input.relationshipStatus - Where the relationship stands.
 * @param input.geoFocus - Geographic focus, free text.
 * @param input.potentialSize - Size bucket as written by the team.
 * @param input.emailDomains - Domains whose mail belongs to this funder.
 * @param input.notes - Free-text notes.
 * @param input.ownerId - Team member who owns the relationship.
 * @param input.status - `active`, or `draft` for AI-proposed funders.
 * @returns The created funder row.
 */
export function createFunderRow({
    name,
    nameKey,
    kind,
    tier,
    relationshipStatus,
    geoFocus,
    potentialSize,
    emailDomains,
    notes,
    ownerId,
    status = 'active',
}: {
    name: string
    nameKey: string
    kind: FunderKind
    tier: FunderTier | null
    relationshipStatus: RelationshipStatus
    geoFocus: string | null
    potentialSize: string | null
    emailDomains: string[]
    notes: string | null
    ownerId: string | null
    status?: FunderStatus
}) {
    return db().funder.create({
        data: {
            id: newId({ kind: 'funder' }),
            name,
            name_key: nameKey,
            kind,
            tier,
            relationship_status: relationshipStatus,
            geo_focus: geoFocus,
            potential_size: potentialSize,
            email_domains: emailDomains,
            notes,
            owner_id: ownerId,
            status,
        },
    })
}

/**
 * Find a funder (including archived ones) with its summary relations.
 *
 * @param input.funderId - The funder's id.
 * @returns The funder, or null.
 */
export function findFunderSummary({ funderId }: { funderId: string }) {
    return db().funder.findUnique({ where: { id: funderId }, include: FUNDER_SUMMARY_INCLUDE })
}

/**
 * Find a bare funder row.
 *
 * @param input.funderId - The funder's id.
 * @returns The funder row, or null.
 */
export function findFunder({ funderId }: { funderId: string }) {
    return db().funder.findUnique({ where: { id: funderId } })
}

/**
 * Find a funder by its normalized name.
 *
 * @param input.nameKey - Output of `funderNameKey`.
 * @returns The funder row, or null.
 */
export function findFunderByNameKey({ nameKey }: { nameKey: string }) {
    return db().funder.findUnique({ where: { name_key: nameKey } })
}

/**
 * List funders with filters, ordered by name.
 *
 * @param input.search - Matches name, geo focus or notes (case-insensitive in SQLite for ASCII).
 * @param input.tier - Only this tier.
 * @param input.relationshipStatus - Only this relationship status.
 * @param input.goalType - Only funders with a live opportunity for this goal.
 * @param input.ownerId - Only funders owned by this user.
 * @param input.status - Only active or only draft funders.
 * @param input.includeArchived - Include archived funders.
 * @returns Funders with summary relations.
 */
export function listFunderSummaries({
    search,
    tier,
    relationshipStatus,
    goalType,
    ownerId,
    status,
    includeArchived,
}: {
    search?: string
    tier?: FunderTier
    relationshipStatus?: RelationshipStatus
    goalType?: GoalType
    ownerId?: string
    status?: FunderStatus
    includeArchived: boolean
}) {
    return db().funder.findMany({
        where: {
            archived_at: includeArchived ? undefined : null,
            tier,
            relationship_status: relationshipStatus,
            owner_id: ownerId,
            status,
            opportunities: goalType ? { some: { archived_at: null, goal: { type: goalType } } } : undefined,
            OR: search
                ? [{ name: { contains: search } }, { geo_focus: { contains: search } }, { notes: { contains: search } }]
                : undefined,
        },
        include: FUNDER_SUMMARY_INCLUDE,
        orderBy: { name: 'asc' },
    })
}

/**
 * Update funder columns directly. Tracked fields must go through `applyFieldChanges` instead.
 *
 * @param input.funderId - The funder.
 * @param input.data - Columns to set.
 * @returns The updated funder row.
 */
export function updateFunderColumns({ funderId, data }: { funderId: string; data: Prisma.FunderUpdateInput }) {
    return db().funder.update({ where: { id: funderId }, data })
}

/**
 * Archive or restore a funder.
 *
 * @param input.funderId - The funder.
 * @param input.archivedAt - When archived, or null to restore.
 * @returns The updated funder row.
 */
export function setFunderArchivedAt({ funderId, archivedAt }: { funderId: string; archivedAt: Date | null }) {
    return db().funder.update({ where: { id: funderId }, data: { archived_at: archivedAt } })
}

/**
 * Names of funders, for labelling change events.
 *
 * @param input.funderIds - The funders.
 * @returns Rows with id and name.
 */
export function findFunderNames({ funderIds }: { funderIds: string[] }) {
    return db().funder.findMany({ where: { id: { in: funderIds } }, select: { id: true, name: true } })
}

/**
 * Every active funder with the addresses and domains used to match its email.
 *
 * @returns Funder ids with contact emails and domains.
 */
export async function listFunderMatchData() {
    const funders = await db().funder.findMany({
        where: { archived_at: null },
        select: {
            id: true,
            email_domains: true,
            contacts: { where: { archived_at: null, email: { not: null } }, select: { email: true } },
        },
    })
    return funders.map(funder => ({
        id: funder.id,
        contactEmails: funder.contacts.map(contact => contact.email!),
        emailDomains: Array.isArray(funder.email_domains) ? (funder.email_domains as string[]) : [],
    }))
}

/**
 * How many AI-drafted funders wait for review.
 *
 * @returns The count.
 */
export function countDraftFunders() {
    return db().funder.count({ where: { status: 'draft', archived_at: null } })
}
