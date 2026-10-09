import { z } from 'zod'
import { OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'

const Probability = z.number().int().min(0).max(100)

export const StageProbabilities = z.object(
    Object.fromEntries(OPPORTUNITY_STAGES.map(stage => [stage, Probability])) as Record<
        (typeof OPPORTUNITY_STAGES)[number],
        typeof Probability
    >,
)
export type StageProbabilities = z.infer<typeof StageProbabilities>
