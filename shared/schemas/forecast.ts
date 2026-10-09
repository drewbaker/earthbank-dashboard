import { z } from 'zod'
import { GOAL_TYPES, MILESTONE_KINDS, OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'
import { DateOnly } from '#shared/schemas/common.ts'

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
})
export type ForecastInputs = z.infer<typeof ForecastInputs>
