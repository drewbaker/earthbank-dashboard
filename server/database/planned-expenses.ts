import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Save a planned expense.
 *
 * @param input.label - What it is, e.g. "Market research study".
 * @param input.kind - `one_off` or `monthly`.
 * @param input.amountCents - The amount, or the amount per month.
 * @param input.startsOn - Payment date or first month.
 * @param input.endsOn - Last month of a monthly expense.
 * @param input.notes - Context for the team.
 * @param input.createdById - Who added it.
 * @returns The row with its creator.
 */
export function createPlannedExpenseRow({
    label,
    kind,
    amountCents,
    startsOn,
    endsOn,
    notes,
    createdById,
}: {
    label: string
    kind: string
    amountCents: bigint
    startsOn: Date
    endsOn: Date | null
    notes: string | null
    createdById: string
}) {
    return db().plannedExpense.create({
        data: {
            id: newId({ kind: 'plannedExpense' }),
            label,
            kind,
            amount_cents: amountCents,
            starts_on: startsOn,
            ends_on: endsOn,
            notes,
            created_by_id: createdById,
        },
        include: { created_by: true },
    })
}

/**
 * Every live planned expense, soonest first.
 *
 * @returns Rows with creators.
 */
export function listPlannedExpenseRows() {
    return db().plannedExpense.findMany({
        where: { archived_at: null },
        include: { created_by: true },
        orderBy: [{ starts_on: 'asc' }, { id: 'asc' }],
    })
}

/**
 * One live planned expense.
 *
 * @param input.plannedExpenseId - The expense.
 * @returns The row, or null.
 */
export function findPlannedExpense({ plannedExpenseId }: { plannedExpenseId: string }) {
    return db().plannedExpense.findFirst({
        where: { id: plannedExpenseId, archived_at: null },
        include: { created_by: true },
    })
}

/**
 * Update a planned expense.
 *
 * @param input.plannedExpenseId - The expense.
 * @param input.data - Columns to set.
 * @returns The row with its creator.
 */
export function updatePlannedExpenseRow({
    plannedExpenseId,
    data,
}: {
    plannedExpenseId: string
    data: Prisma.PlannedExpenseUpdateInput
}) {
    return db().plannedExpense.update({ where: { id: plannedExpenseId }, data, include: { created_by: true } })
}
