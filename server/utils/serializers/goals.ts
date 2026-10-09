import type { Goal as GoalRow, Opportunity as OpportunityRow } from '#server/generated/prisma/client.ts'
import { centsToNumber, toDateOnly } from '#server/utils/dates.ts'
import type { GoalType, OpportunityStage } from '#shared/constants/pipeline.ts'
import { OPPORTUNITY_STAGE_DETAILS } from '#shared/constants/pipeline.ts'
import type { Goal } from '#shared/schemas/index.ts'
import type { StageProbabilities } from '#shared/utils/probability.ts'
import { opportunityProbability, weightedAmountCents } from '#shared/utils/probability.ts'

/**
 * Public shape of a goal with its pipeline totals.
 *
 * @param input.goal - The goal with its live opportunities.
 * @param input.stageProbabilities - The team's probability per stage.
 * @returns The API representation.
 */
export function serializeGoal({
    goal,
    stageProbabilities,
}: {
    goal: GoalRow & { opportunities: OpportunityRow[] }
    stageProbabilities: StageProbabilities
}): Goal {
    const totals = {
        opportunity_count: 0,
        open_amount_cents: 0,
        weighted_open_cents: 0,
        committed_cents: 0,
        received_cents: 0,
    }
    for (const opportunity of goal.opportunities) {
        const stage = opportunity.stage as OpportunityStage
        const amountCents = centsToNumber({ cents: opportunity.amount_cents }) ?? 0
        if (stage === 'lost') {
            continue
        }
        totals.opportunity_count++
        if (OPPORTUNITY_STAGE_DETAILS[stage].isOpen) {
            const probability = opportunityProbability({
                stage,
                probabilityOverride: opportunity.probability_override,
                stageProbabilities,
            })
            totals.open_amount_cents += amountCents
            totals.weighted_open_cents += weightedAmountCents({ amountCents, probability })
        } else if (stage === 'committed') {
            totals.committed_cents += amountCents
        } else {
            totals.received_cents += amountCents
        }
    }
    return {
        id: goal.id,
        type: goal.type as GoalType,
        name: goal.name,
        target_amount_cents: centsToNumber({ cents: goal.target_amount_cents }),
        target_date: toDateOnly({ date: goal.target_date }),
        notes: goal.notes,
        totals,
    }
}
