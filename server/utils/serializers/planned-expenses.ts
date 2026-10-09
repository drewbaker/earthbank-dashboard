import type { PlannedExpense as PlannedExpenseRow, User as UserRow } from '#server/generated/prisma/client.ts'
import { centsToNumber, toDateOnly, toIsoDateTime } from '#server/utils/dates.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import type { PlannedExpense } from '#shared/schemas/index.ts'

/**
 * Public shape of a planned expense.
 *
 * @param input.plannedExpense - The row with its creator.
 * @returns The API representation.
 */
export function serializePlannedExpense({
    plannedExpense,
}: {
    plannedExpense: PlannedExpenseRow & { created_by: UserRow | null }
}): PlannedExpense {
    return {
        id: plannedExpense.id,
        label: plannedExpense.label,
        kind: plannedExpense.kind === 'monthly' ? 'monthly' : 'one_off',
        amount_cents: centsToNumber({ cents: plannedExpense.amount_cents }) ?? 0,
        starts_on: toDateOnly({ date: plannedExpense.starts_on })!,
        ends_on: plannedExpense.kind === 'monthly' ? toDateOnly({ date: plannedExpense.ends_on }) : null,
        notes: plannedExpense.notes,
        created_by: serializeUserSummary({ user: plannedExpense.created_by }),
        created_at: toIsoDateTime({ date: plannedExpense.created_at })!,
        updated_at: toIsoDateTime({ date: plannedExpense.updated_at })!,
    }
}
