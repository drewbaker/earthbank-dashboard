import { z } from 'zod'
import { Cents, DateOnly, DateOnlyInput, IsoDateTime, listOf, UserSummary } from '#shared/schemas/common.ts'

export const PLANNED_EXPENSE_KINDS = ['one_off', 'monthly'] as const
export type PlannedExpenseKind = (typeof PLANNED_EXPENSE_KINDS)[number]

// Spending the team has decided on but not paid yet; part of the base forecast.
export const PlannedExpense = z.object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(PLANNED_EXPENSE_KINDS),
    /** The one-off amount, or the amount per month. */
    amount_cents: Cents,
    /** Payment date (one-off) or first month (monthly). */
    starts_on: DateOnly,
    /** Last month of a monthly expense; null = ongoing. */
    ends_on: DateOnly.nullable(),
    notes: z.string().nullable(),
    created_by: UserSummary.nullable(),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
})
export type PlannedExpense = z.infer<typeof PlannedExpense>

export const PlannedExpenseList = listOf(PlannedExpense)
export type PlannedExpenseList = z.infer<typeof PlannedExpenseList>

const PlannedExpenseFields = z.object({
    label: z.string().trim().min(1, 'Name it, e.g. "Market research study".').max(120),
    kind: z.enum(PLANNED_EXPENSE_KINDS),
    amount_cents: Cents.refine(cents => cents > 0, 'Enter an amount.'),
    starts_on: DateOnlyInput,
    ends_on: DateOnlyInput.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
})

export const CreatePlannedExpenseRequest = PlannedExpenseFields.refine(
    expense => !expense.ends_on || expense.ends_on >= expense.starts_on,
    { message: 'The end must be after the start.', path: ['ends_on'] },
)
export type CreatePlannedExpenseRequest = z.infer<typeof CreatePlannedExpenseRequest>

export const UpdatePlannedExpenseRequest = PlannedExpenseFields.partial()
export type UpdatePlannedExpenseRequest = z.infer<typeof UpdatePlannedExpenseRequest>
