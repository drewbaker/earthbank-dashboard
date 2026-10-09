import { readSettingValue, writeSettingValue } from '#server/database/settings.ts'
import type { StageProbabilities } from '#shared/schemas/settings.ts'
import { StageProbabilities as StageProbabilitiesSchema } from '#shared/schemas/settings.ts'
import { defaultStageProbabilities } from '#shared/utils/probability.ts'

const STAGE_PROBABILITIES_KEY = 'stage_probabilities'

/**
 * The team's probability per stage, falling back to defaults for anything unset or invalid.
 *
 * @returns Stage → probability (0–100).
 */
export async function readStageProbabilities(): Promise<StageProbabilities> {
    const stored = await readSettingValue({ key: STAGE_PROBABILITIES_KEY })
    const merged = { ...defaultStageProbabilities(), ...(typeof stored === 'object' && stored !== null ? stored : {}) }
    const parsed = StageProbabilitiesSchema.safeParse(merged)
    return parsed.success ? parsed.data : defaultStageProbabilities()
}

/**
 * Save the team's probability per stage.
 *
 * @param input.stageProbabilities - Stage → probability (validated by the caller).
 * @returns The saved probabilities.
 */
export async function writeStageProbabilities({ stageProbabilities }: { stageProbabilities: StageProbabilities }) {
    await writeSettingValue({ key: STAGE_PROBABILITIES_KEY, value: stageProbabilities })
    return stageProbabilities
}
