import { z } from 'zod'
import { Cents, DateOnly, IsoDateTime, listOf, UserSummary } from '#shared/schemas/common.ts'

// One what-if change to the forecast. Opportunity adjustments refer to opportunities by id; costs
// and income are entered directly.
export const ScenarioAdjustment = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('shift_receipt'),
        opportunity_id: z.string(),
        months: z.number().int().min(-24).max(36),
    }),
    z.object({ kind: z.literal('change_amount'), opportunity_id: z.string(), amount_cents: Cents }),
    z.object({
        kind: z.literal('change_probability'),
        opportunity_id: z.string(),
        probability: z.number().int().min(0).max(100),
    }),
    z.object({ kind: z.literal('exclude_opportunity'), opportunity_id: z.string() }),
    z.object({
        kind: z.literal('add_recurring_cost'),
        label: z.string().trim().min(1).max(120),
        monthly_cents: Cents,
        starts_at: DateOnly,
        ends_at: DateOnly.nullable().default(null),
    }),
    z.object({
        kind: z.literal('add_one_off'),
        label: z.string().trim().min(1).max(120),
        // Positive = money in (e.g. a new gift); negative = a one-off cost.
        amount_cents: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
        at: DateOnly,
    }),
    z.object({ kind: z.literal('change_burn_pct'), pct: z.number().min(-90).max(500), starts_at: DateOnly }),
    // "What if we don't do it": leave a planned expense out of this scenario.
    z.object({ kind: z.literal('exclude_planned_expense'), planned_expense_id: z.string() }),
])
export type ScenarioAdjustment = z.infer<typeof ScenarioAdjustment>

export const Scenario = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    adjustments: z.array(ScenarioAdjustment),
    created_by: UserSummary.nullable(),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
})
export type Scenario = z.infer<typeof Scenario>

export const ScenarioList = listOf(Scenario)
export type ScenarioList = z.infer<typeof ScenarioList>

export const CreateScenarioRequest = z.object({
    name: z.string().trim().min(1, 'Name the scenario.').max(120),
    description: z.string().trim().max(2000).nullish(),
    adjustments: z.array(ScenarioAdjustment).max(100).default([]),
})
export type CreateScenarioRequest = z.infer<typeof CreateScenarioRequest>

export const UpdateScenarioRequest = CreateScenarioRequest.partial()
export type UpdateScenarioRequest = z.infer<typeof UpdateScenarioRequest>
