import {
    FUNDER_KIND_LABELS,
    FUNDER_TIER_DETAILS,
    GOAL_TYPE_DETAILS,
    OPPORTUNITY_STAGE_DETAILS,
    RELATIONSHIP_STATUS_DETAILS,
} from '#shared/constants/pipeline.ts'
import type {
    FunderKind,
    FunderTier,
    GoalType,
    OpportunityStage,
    RelationshipStatus,
} from '#shared/constants/pipeline.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'

const FIELD_LABELS: Record<string, string> = {
    name: 'Name',
    kind: 'Kind',
    tier: 'Tier',
    relationship_status: 'Relationship',
    geo_focus: 'Geo focus',
    potential_size: 'Potential size',
    email_domains: 'Email domains',
    materials_sent_at: 'Materials sent',
    last_contact_at: 'Last contact',
    last_contact_note: 'Last contact note',
    notes: 'Notes',
    owner_id: 'Owner',
    status: 'Status',
    goal_id: 'Goal',
    stage: 'Stage',
    amount_cents: 'Amount',
    probability_override: 'Probability',
    expected_decision_at: 'Expected decision',
    expected_receipt_at: 'Expected receipt',
    received_at: 'Received',
    next_step: 'Next step',
}

export type ChangeValueLookups = {
    userNames: Map<string, string>
    goalTypeById: Map<string, GoalType>
}

/**
 * Human label for a tracked field.
 *
 * @param input.field - Field name from the change log.
 * @returns The label.
 */
export function changeFieldLabel({ field }: { field: string }) {
    return FIELD_LABELS[field] ?? field.replace(/_/g, ' ')
}

/**
 * Human form of a value in the change log.
 *
 * @param input.field - Field name.
 * @param input.value - Value as stored in the change log.
 * @param input.lookups - User names and goal types for id fields.
 * @returns Display text.
 */
export function formatChangeValue({
    field,
    value,
    lookups,
}: {
    field: string
    value: unknown
    lookups: ChangeValueLookups
}) {
    if (value === null || value === undefined || value === '') {
        return 'empty'
    }
    switch (field) {
        case 'amount_cents':
            return formatMoney({ cents: value as number })
        case 'probability_override':
            return `${value}%`
        case 'stage':
            return OPPORTUNITY_STAGE_DETAILS[value as OpportunityStage]?.label ?? String(value)
        case 'tier':
            return FUNDER_TIER_DETAILS[value as FunderTier]?.label ?? String(value)
        case 'relationship_status':
            return RELATIONSHIP_STATUS_DETAILS[value as RelationshipStatus]?.label ?? String(value)
        case 'kind':
            return FUNDER_KIND_LABELS[value as FunderKind] ?? String(value)
        case 'owner_id':
            return lookups.userNames.get(value as string) ?? 'a former team member'
        case 'goal_id': {
            const goalType = lookups.goalTypeById.get(value as string)
            return goalType ? GOAL_TYPE_DETAILS[goalType].label : 'another goal'
        }
        case 'email_domains':
            return (value as string[]).join(', ') || 'none'
        default:
            if (field.endsWith('_at')) {
                return formatDate({ value: value as string })
            }
            return String(value).length > 120 ? `${String(value).slice(0, 117)}…` : String(value)
    }
}
