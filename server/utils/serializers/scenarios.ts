import type { Scenario as ScenarioRow, User as UserRow } from '#server/generated/prisma/client.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import type { Scenario } from '#shared/schemas/index.ts'
import { ScenarioAdjustment } from '#shared/schemas/index.ts'

/**
 * Public shape of a scenario. Stored adjustments are re-validated; any that no longer parse are dropped.
 *
 * @param input.scenario - The scenario with its creator.
 * @returns The API representation.
 */
export function serializeScenario({ scenario }: { scenario: ScenarioRow & { created_by: UserRow | null } }): Scenario {
    const stored = Array.isArray(scenario.adjustments) ? scenario.adjustments : []
    return {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        adjustments: stored.flatMap(adjustment => {
            const parsed = ScenarioAdjustment.safeParse(adjustment)
            return parsed.success ? [parsed.data] : []
        }),
        created_by: serializeUserSummary({ user: scenario.created_by }),
        created_at: scenario.created_at.toISOString(),
        updated_at: scenario.updated_at.toISOString(),
    }
}
