import type { OpportunityRow } from '#server/database/opportunities.ts'
import { centsToNumber, toDateOnly, toIsoDateTime } from '#server/utils/dates.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import type { FunderTier, GoalType, OpportunityStage } from '#shared/constants/pipeline.ts'
import type { Opportunity } from '#shared/schemas/index.ts'
import type { StageProbabilities } from '#shared/utils/probability.ts'
import { opportunityProbability, weightedAmountCents } from '#shared/utils/probability.ts'

/**
 * Public shape of an opportunity, with its probability and weighted amount computed.
 *
 * @param input.opportunity - The opportunity with funder, goal and owner.
 * @param input.stageProbabilities - The team's probability per stage.
 * @returns The API representation.
 */
export function serializeOpportunity({
    opportunity,
    stageProbabilities,
}: {
    opportunity: OpportunityRow
    stageProbabilities: StageProbabilities
}): Opportunity {
    const stage = opportunity.stage as OpportunityStage
    const amountCents = centsToNumber({ cents: opportunity.amount_cents })
    const probability = opportunityProbability({
        stage,
        probabilityOverride: opportunity.probability_override,
        stageProbabilities,
    })
    return {
        id: opportunity.id,
        funder: {
            id: opportunity.funder.id,
            name: opportunity.funder.name,
            tier: opportunity.funder.tier as FunderTier | null,
        },
        goal_id: opportunity.goal_id,
        goal_type: opportunity.goal.type as GoalType,
        name: opportunity.name,
        stage,
        amount_cents: amountCents,
        probability,
        probability_override: opportunity.probability_override,
        weighted_amount_cents: weightedAmountCents({ amountCents, probability }),
        expected_decision_at: toDateOnly({ date: opportunity.expected_decision_at }),
        expected_receipt_at: toDateOnly({ date: opportunity.expected_receipt_at }),
        received_at: toDateOnly({ date: opportunity.received_at }),
        next_step: opportunity.next_step,
        owner: serializeUserSummary({ user: opportunity.owner }),
        archived_at: toIsoDateTime({ date: opportunity.archived_at }),
        created_at: opportunity.created_at.toISOString(),
        updated_at: opportunity.updated_at.toISOString(),
    }
}
