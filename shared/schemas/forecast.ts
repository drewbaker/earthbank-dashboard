import { z } from 'zod'
import { GOAL_TYPES, MILESTONE_KINDS, OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'
import { DateOnly } from '#shared/schemas/common.ts'
import { PLANNED_EXPENSE_KINDS } from '#shared/schemas/planned-expenses.ts'

// Everything the browser needs to run the runway projection itself (live as scenarios change).
export const ForecastInputs = z.object({
    today: DateOnly,
    starting_cash_cents: z.number().int().nullable(),
    monthly_burn_cents: z.number().int().nullable(),
    include_goal_types: z.array(z.enum(GOAL_TYPES)),
    opportunities: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            funder_id: z.string(),
            funder_name: z.string(),
            goal_type: z.enum(GOAL_TYPES),
            stage: z.enum(OPPORTUNITY_STAGES),
            amount_cents: z.number().int().nullable(),
            expected_receipt_at: DateOnly.nullable(),
            probability: z.number().int(),
        }),
    ),
    milestones: z.array(
        z.object({ id: z.string(), title: z.string(), due_at: DateOnly, kind: z.enum(MILESTONE_KINDS) }),
    ),
    planned_expenses: z.array(
        z.object({
            id: z.string(),
            label: z.string(),
            kind: z.enum(PLANNED_EXPENSE_KINDS),
            amount_cents: z.number().int(),
            starts_on: DateOnly,
            ends_on: DateOnly.nullable(),
        }),
    ),
})
export type ForecastInputs = z.infer<typeof ForecastInputs>
