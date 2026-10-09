import { z } from 'zod'
import { FUNDER_TIERS, GOAL_TYPES, OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'
import {
    Cents,
    CursorQuery,
    DateOnly,
    DateOnlyInput,
    IsoDateTime,
    listOf,
    queryBoolean,
    UserSummary,
} from '#shared/schemas/common.ts'
import { isGeoFocusCode } from '#shared/utils/geo-focus.ts'

export const Opportunity = z.object({
    id: z.string(),
    funder: z.object({ id: z.string(), name: z.string(), tier: z.enum(FUNDER_TIERS).nullable() }),
    goal_id: z.string(),
    goal_type: z.enum(GOAL_TYPES),
    name: z.string(),
    stage: z.enum(OPPORTUNITY_STAGES),
    amount_cents: Cents.nullable(),
    probability: z.number().int().min(0).max(100),
    probability_override: z.number().int().min(0).max(100).nullable(),
    weighted_amount_cents: Cents,
    expected_decision_at: DateOnly.nullable(),
    expected_receipt_at: DateOnly.nullable(),
    /** When it went to the funder's committee. */
    committee_on: DateOnly.nullable(),
    /** Geographic focus: country codes ("KE"), regions ("region:eastern_africa") or "global". */
    focus_areas: z.array(z.string()),
    received_at: DateOnly.nullable(),
    next_step: z.string().nullable(),
    owner: UserSummary.nullable(),
    archived_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
})
export type Opportunity = z.infer<typeof Opportunity>

export const OpportunityList = listOf(Opportunity)
export type OpportunityList = z.infer<typeof OpportunityList>

const OpportunityFields = {
    goal_type: z.enum(GOAL_TYPES),
    name: z.string().trim().min(1, 'Name is required.').max(200),
    stage: z.enum(OPPORTUNITY_STAGES),
    amount_cents: Cents.nullable(),
    probability_override: z.number().int().min(0).max(100).nullable(),
    expected_decision_at: DateOnlyInput.nullable(),
    expected_receipt_at: DateOnlyInput.nullable(),
    committee_on: DateOnlyInput.nullable(),
    focus_areas: z.array(z.string().refine(code => isGeoFocusCode({ code }), 'Unknown country or region.')).max(60),
    received_at: DateOnlyInput.nullable(),
    next_step: z.string().trim().max(2000).nullable(),
    owner_id: z.string().nullable(),
}

export const CreateOpportunityRequest = z.object({
    funder_id: z.string(),
    goal_type: OpportunityFields.goal_type,
    name: OpportunityFields.name,
    stage: OpportunityFields.stage.default('identified'),
    amount_cents: OpportunityFields.amount_cents.optional(),
    probability_override: OpportunityFields.probability_override.optional(),
    expected_decision_at: OpportunityFields.expected_decision_at.optional(),
    expected_receipt_at: OpportunityFields.expected_receipt_at.optional(),
    committee_on: OpportunityFields.committee_on.optional(),
    focus_areas: OpportunityFields.focus_areas.default([]),
    received_at: OpportunityFields.received_at.optional(),
    next_step: OpportunityFields.next_step.optional(),
    owner_id: OpportunityFields.owner_id.optional(),
})
export type CreateOpportunityRequest = z.infer<typeof CreateOpportunityRequest>

export const UpdateOpportunityRequest = z.object(OpportunityFields).partial()
export type UpdateOpportunityRequest = z.infer<typeof UpdateOpportunityRequest>

export const ListOpportunitiesQuery = CursorQuery.extend({
    goal_type: z.enum(GOAL_TYPES).optional(),
    stage: z.enum(OPPORTUNITY_STAGES).optional(),
    funder_id: z.string().optional(),
    owner_id: z.string().optional(),
    include_closed: queryBoolean(),
    include_archived: queryBoolean(),
})
