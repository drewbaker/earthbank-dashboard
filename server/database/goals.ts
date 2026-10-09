import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'
import type { GoalType } from '#shared/constants/pipeline.ts'
import { GOAL_TYPE_DETAILS, GOAL_TYPES } from '#shared/constants/pipeline.ts'

/**
 * Create the three funding goals if they don't exist yet. Safe to call on every boot.
 *
 * @returns Resolves once all three goals exist.
 */
export async function ensureDefaultGoals() {
    for (const [index, type] of GOAL_TYPES.entries()) {
        await db().goal.upsert({
            where: { type },
            create: { id: newId({ kind: 'goal' }), type, name: GOAL_TYPE_DETAILS[type].label, sort: index },
            update: {},
        })
    }
}

/**
 * List the goals with their non-archived opportunities (for totals).
 *
 * @returns Goals in display order.
 */
export function listGoalsWithOpportunities() {
    return db().goal.findMany({
        orderBy: { sort: 'asc' },
        include: { opportunities: { where: { archived_at: null, funder: { archived_at: null } } } },
    })
}

/**
 * Find one goal with its non-archived opportunities.
 *
 * @param input.goalId - The goal's id.
 * @returns The goal, or null.
 */
export function findGoalWithOpportunities({ goalId }: { goalId: string }) {
    return db().goal.findUnique({
        where: { id: goalId },
        include: { opportunities: { where: { archived_at: null, funder: { archived_at: null } } } },
    })
}

/**
 * Find a goal by type.
 *
 * @param input.type - Goal type.
 * @returns The goal row, or null.
 */
export function findGoalByType({ type }: { type: GoalType }) {
    return db().goal.findUnique({ where: { type } })
}

/**
 * Map every goal type to its id.
 *
 * @returns Goal type → goal id.
 */
export async function goalIdsByType() {
    const goals = await db().goal.findMany({ select: { id: true, type: true } })
    return new Map(goals.map(goal => [goal.type, goal.id]))
}

/**
 * Update a goal's target and notes.
 *
 * @param input.goalId - The goal.
 * @param input.name - New display name, if changing.
 * @param input.targetAmountCents - New target, null to clear, undefined to keep.
 * @param input.targetDate - New target date, null to clear, undefined to keep.
 * @param input.notes - New notes, null to clear, undefined to keep.
 * @returns The updated goal row.
 */
export function updateGoalRow({
    goalId,
    name,
    targetAmountCents,
    targetDate,
    notes,
}: {
    goalId: string
    name?: string
    targetAmountCents?: bigint | null
    targetDate?: Date | null
    notes?: string | null
}) {
    return db().goal.update({
        where: { id: goalId },
        data: { name, target_amount_cents: targetAmountCents, target_date: targetDate, notes },
    })
}
