import type { OpportunityStage } from '#shared/constants/pipeline.ts'
import { COMMITTEE_MIN_PROBABILITY, OPPORTUNITY_STAGE_DETAILS } from '#shared/constants/pipeline.ts'

export type StageProbabilities = Record<OpportunityStage, number>

/**
 * The default probability (0–100) for every stage.
 *
 * @returns Stage → probability.
 */
export function defaultStageProbabilities(): StageProbabilities {
    return Object.fromEntries(
        Object.entries(OPPORTUNITY_STAGE_DETAILS).map(([stage, details]) => [stage, details.defaultProbability]),
    ) as StageProbabilities
}

/**
 * The probability an opportunity lands: its override, else its stage's probability. Once it's in
 * committee it's never below `COMMITTEE_MIN_PROBABILITY`, whatever the override says.
 *
 * @param input.stage - Opportunity stage.
 * @param input.probabilityOverride - Per-opportunity override (0–100), or null.
 * @param input.stageProbabilities - Team-wide probability per stage.
 * @returns A probability from 0 to 100.
 */
export function opportunityProbability({
    stage,
    probabilityOverride,
    stageProbabilities,
}: {
    stage: OpportunityStage
    probabilityOverride: number | null
    stageProbabilities: StageProbabilities
}) {
    const probability = probabilityOverride ?? stageProbabilities[stage]
    return stage === 'in_committee' ? Math.max(COMMITTEE_MIN_PROBABILITY, probability) : probability
}

/**
 * Probability-weighted amount in cents.
 *
 * @param input.amountCents - Full amount, or null when unknown.
 * @param input.probability - 0–100.
 * @returns The weighted amount (0 when the amount is unknown).
 */
export function weightedAmountCents({ amountCents, probability }: { amountCents: number | null; probability: number }) {
    return Math.round(((amountCents ?? 0) * probability) / 100)
}
