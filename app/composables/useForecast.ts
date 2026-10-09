import { computed } from 'vue'
import type { Ref } from 'vue'
import { useAsyncData } from '#imports'
import type { RunwayProjection } from '#shared/forecast/project-runway.ts'
import { projectRunway } from '#shared/forecast/project-runway.ts'
import type { ForecastInputs, ScenarioAdjustment } from '#shared/schemas/index.ts'
import { useApi } from '~/composables/useApi.ts'

/**
 * Load the forecast inputs and project the runway in the browser, with and without a scenario.
 *
 * @param input.adjustments - The scenario being explored (empty for none).
 * @returns The inputs, the base projection, the scenario projection and whether cash/burn are known.
 */
export function useForecast({ adjustments }: { adjustments?: Ref<ScenarioAdjustment[]> } = {}) {
    const api = useApi()
    const inputs = useAsyncData('forecast.inputs', () => api<ForecastInputs>({ path: '/forecast' }))

    const isReady = computed(
        () => inputs.data.value?.starting_cash_cents !== null && inputs.data.value?.starting_cash_cents !== undefined,
    )

    /**
     * Run the projection with a set of adjustments.
     *
     * @param input.withAdjustments - Scenario adjustments.
     * @returns The projection, or null before cash is known.
     */
    function project({ withAdjustments }: { withAdjustments: ScenarioAdjustment[] }): RunwayProjection | null {
        const data = inputs.data.value
        if (!data || data.starting_cash_cents === null) {
            return null
        }
        return projectRunway({
            today: data.today,
            startingCashCents: data.starting_cash_cents,
            monthlyBurnCents: data.monthly_burn_cents ?? 0,
            opportunities: data.opportunities,
            milestones: data.milestones,
            includeGoalTypes: data.include_goal_types,
            adjustments: withAdjustments,
        })
    }

    const baseProjection = computed(() => project({ withAdjustments: [] }))
    const scenarioProjection = computed(() =>
        adjustments && adjustments.value.length > 0 ? project({ withAdjustments: adjustments.value }) : null,
    )

    return { inputs, isReady, baseProjection, scenarioProjection }
}
