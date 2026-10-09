import { z } from 'zod'
import { GOAL_TYPES, MILESTONE_KINDS, MILESTONE_STATUSES } from '#shared/constants/pipeline.ts'
import { DateOnly, DateOnlyInput, IsoDateTime, listOf, queryBoolean } from '#shared/schemas/common.ts'

export const OpportunityReference = z.object({
    id: z.string(),
    name: z.string(),
    funder: z.object({ id: z.string(), name: z.string() }),
})
export type OpportunityReference = z.infer<typeof OpportunityReference>

export const Milestone = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    due_at: DateOnly,
    kind: z.enum(MILESTONE_KINDS),
    status: z.enum(MILESTONE_STATUSES),
    is_overdue: z.boolean(),
    goal_type: z.enum(GOAL_TYPES).nullable(),
    opportunity: OpportunityReference.nullable(),
    funder: z.object({ id: z.string(), name: z.string() }).nullable(),
    task_counts: z.object({ total: z.number().int(), done: z.number().int() }),
    created_at: IsoDateTime,
})
export type Milestone = z.infer<typeof Milestone>

export const MilestoneList = listOf(Milestone)
export type MilestoneList = z.infer<typeof MilestoneList>

const MilestoneFields = {
    title: z.string().trim().min(1, 'Title is required.').max(200),
    description: z.string().trim().max(5000).nullable(),
    due_at: DateOnlyInput,
    kind: z.enum(MILESTONE_KINDS),
    status: z.enum(MILESTONE_STATUSES),
    goal_type: z.enum(GOAL_TYPES).nullable(),
    opportunity_id: z.string().nullable(),
}

export const CreateMilestoneRequest = z.object({
    title: MilestoneFields.title,
    description: MilestoneFields.description.optional(),
    due_at: MilestoneFields.due_at,
    kind: MilestoneFields.kind.default('funding'),
    goal_type: MilestoneFields.goal_type.optional(),
    opportunity_id: MilestoneFields.opportunity_id.optional(),
})
export type CreateMilestoneRequest = z.infer<typeof CreateMilestoneRequest>

export const UpdateMilestoneRequest = z.object(MilestoneFields).partial()
export type UpdateMilestoneRequest = z.infer<typeof UpdateMilestoneRequest>

export const ListMilestonesQuery = z.object({
    include_done: queryBoolean(),
    funder_id: z.string().optional(),
    goal_type: z.enum(GOAL_TYPES).optional(),
    due_before: DateOnly.optional(),
})
