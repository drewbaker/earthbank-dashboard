import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'
import type { GoalType, OpportunityStage } from '#shared/constants/pipeline.ts'
import { OPPORTUNITY_STAGE_DETAILS } from '#shared/constants/pipeline.ts'

export const OPPORTUNITY_INCLUDE = {
    funder: true,
    goal: true,
    owner: true,
} satisfies Prisma.OpportunityInclude

export type OpportunityRow = Prisma.OpportunityGetPayload<{ include: typeof OPPORTUNITY_INCLUDE }>

const OPEN_STAGES = Object.entries(OPPORTUNITY_STAGE_DETAILS)
    .filter(([, details]) => details.isOpen)
    .map(([stage]) => stage)

/**
 * Create an opportunity.
 *
 * @param input.funderId - The funder being asked.
 * @param input.goalId - The goal it counts toward.
 * @param input.name - Short name, e.g. "Design grant".
 * @param input.stage - Pipeline stage.
 * @param input.amountCents - Amount, if known.
 * @param input.probabilityOverride - 0–100 override, or null.
 * @param input.expectedDecisionAt - Expected decision date.
 * @param input.expectedReceiptAt - Expected date the money lands.
 * @param input.receivedAt - Date received.
 * @param input.nextStep - What happens next.
 * @param input.ownerId - Team member who owns it.
 * @returns The opportunity with its relations.
 */
export function createOpportunityRow({
    funderId,
    goalId,
    name,
    stage,
    amountCents,
    probabilityOverride,
    expectedDecisionAt,
    expectedReceiptAt,
    receivedAt,
    nextStep,
    ownerId,
}: {
    funderId: string
    goalId: string
    name: string
    stage: OpportunityStage
    amountCents: bigint | null
    probabilityOverride: number | null
    expectedDecisionAt: Date | null
    expectedReceiptAt: Date | null
    receivedAt: Date | null
    nextStep: string | null
    ownerId: string | null
}) {
    return db().opportunity.create({
        data: {
            id: newId({ kind: 'opportunity' }),
            funder_id: funderId,
            goal_id: goalId,
            name,
            stage,
            amount_cents: amountCents,
            probability_override: probabilityOverride,
            expected_decision_at: expectedDecisionAt,
            expected_receipt_at: expectedReceiptAt,
            received_at: receivedAt,
            next_step: nextStep,
            owner_id: ownerId,
        },
        include: OPPORTUNITY_INCLUDE,
    })
}

/**
 * Find an opportunity with its funder, goal and owner.
 *
 * @param input.opportunityId - The opportunity.
 * @returns The opportunity, or null.
 */
export function findOpportunity({ opportunityId }: { opportunityId: string }) {
    return db().opportunity.findUnique({ where: { id: opportunityId }, include: OPPORTUNITY_INCLUDE })
}

/**
 * List opportunities with filters, soonest expected receipt first (undated last).
 *
 * @param input.goalType - Only this goal.
 * @param input.stage - Only this stage.
 * @param input.funderId - Only this funder.
 * @param input.ownerId - Only this owner.
 * @param input.includeClosed - Include committed, received and lost opportunities.
 * @param input.includeArchived - Include archived opportunities and those of archived funders.
 * @returns Opportunities with relations.
 */
export function listOpportunityRows({
    goalType,
    stage,
    funderId,
    ownerId,
    includeClosed,
    includeArchived,
}: {
    goalType?: GoalType
    stage?: OpportunityStage
    funderId?: string
    ownerId?: string
    includeClosed: boolean
    includeArchived: boolean
}) {
    return db().opportunity.findMany({
        where: {
            goal: goalType ? { type: goalType } : undefined,
            stage: stage ?? (includeClosed ? undefined : { in: OPEN_STAGES }),
            funder_id: funderId,
            owner_id: ownerId,
            archived_at: includeArchived ? undefined : null,
            funder: includeArchived ? undefined : { archived_at: null },
        },
        include: OPPORTUNITY_INCLUDE,
        orderBy: [{ expected_receipt_at: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    })
}

/**
 * Update opportunity columns directly. Tracked fields must go through `applyFieldChanges` instead.
 *
 * @param input.opportunityId - The opportunity.
 * @param input.data - Columns to set.
 * @returns The updated opportunity row.
 */
export function updateOpportunityColumns({
    opportunityId,
    data,
}: {
    opportunityId: string
    data: Prisma.OpportunityUncheckedUpdateInput
}) {
    return db().opportunity.update({ where: { id: opportunityId }, data })
}

/**
 * Ids of every opportunity a funder has had, including archived ones.
 *
 * @param input.funderId - The funder.
 * @returns Opportunity ids.
 */
export async function listOpportunityIdsForFunder({ funderId }: { funderId: string }) {
    const rows = await db().opportunity.findMany({ where: { funder_id: funderId }, select: { id: true } })
    return rows.map(row => row.id)
}

/**
 * Names of opportunities and their funders, for labelling change events.
 *
 * @param input.opportunityIds - The opportunities.
 * @returns Rows with id, name and funder id/name.
 */
export function findOpportunityNames({ opportunityIds }: { opportunityIds: string[] }) {
    return db().opportunity.findMany({
        where: { id: { in: opportunityIds } },
        select: { id: true, name: true, funder: { select: { id: true, name: true } } },
    })
}
