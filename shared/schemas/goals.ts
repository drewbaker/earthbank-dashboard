import { z } from 'zod'
import { GOAL_TYPES } from '#shared/constants/pipeline.ts'
import { Cents, DateOnly, DateOnlyInput, listOf } from '#shared/schemas/common.ts'

export const GoalTotals = z.object({
    opportunity_count: z.number().int(),
    open_amount_cents: Cents,
    weighted_open_cents: Cents,
    committed_cents: Cents,
    received_cents: Cents,
})

export const Goal = z.object({
    id: z.string(),
    type: z.enum(GOAL_TYPES),
    name: z.string(),
    target_amount_cents: Cents.nullable(),
    target_date: DateOnly.nullable(),
    notes: z.string().nullable(),
    totals: GoalTotals,
})
export type Goal = z.infer<typeof Goal>

export const GoalList = listOf(Goal)
export type GoalList = z.infer<typeof GoalList>

export const UpdateGoalRequest = z
    .object({
        name: z.string().trim().min(1).max(100),
        target_amount_cents: Cents.nullable(),
        target_date: DateOnlyInput.nullable(),
        notes: z.string().trim().max(5000).nullable(),
    })
    .partial()
export type UpdateGoalRequest = z.infer<typeof UpdateGoalRequest>
