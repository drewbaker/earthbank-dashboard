import { z } from 'zod'
import { COMMITTEE_MIN_PROBABILITY, OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'

const Probability = z.number().int().min(0).max(100)

export const StageProbabilities = z
    .object(
        Object.fromEntries(OPPORTUNITY_STAGES.map(stage => [stage, Probability])) as Record<
            (typeof OPPORTUNITY_STAGES)[number],
            typeof Probability
        >,
    )
    .refine(probabilities => probabilities.in_committee >= COMMITTEE_MIN_PROBABILITY, {
        message: `In committee is at least ${COMMITTEE_MIN_PROBABILITY}%.`,
        path: ['in_committee'],
    })
export type StageProbabilities = z.infer<typeof StageProbabilities>
