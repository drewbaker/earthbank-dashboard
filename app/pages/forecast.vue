<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { computed, h, ref, useTemplateRef, watch } from 'vue'
import { useAsyncData, useSeoMeta, useToast } from '#imports'
import { GOAL_TYPE_DETAILS } from '#shared/constants/pipeline.ts'
import type { ForecastInflow, RunwayEnd } from '#shared/forecast/project-runway.ts'
import type {
    OpportunityList,
    PlannedExpense,
    Scenario,
    ScenarioAdjustment,
    ScenarioList,
} from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { useForecast } from '~/composables/useForecast.ts'
import { describeAdjustment, ADJUSTMENT_KIND_DETAILS } from '~/utils/scenario-descriptions.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'
import { sortableColumns } from '~/utils/table-sorting.ts'

useSeoMeta({ title: 'Forecast · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()

const NEW_SCENARIO = 'new'
const adjustments = ref<ScenarioAdjustment[]>([])
const scenarioName = ref('')
const selectedScenarioId = ref<string>(NEW_SCENARIO)
const isSaving = ref(false)

const { inputs, isReady, baseProjection, scenarioProjection } = useForecast({ adjustments })
const { data: scenarioList, refresh: refreshScenarios } = await useAsyncData('forecast.scenarios', () =>
    api<ScenarioList>({ path: '/scenarios' }),
)
await inputs
const { data: lendingOpportunities } = await useAsyncData('forecast.lending', () =>
    api<OpportunityList>({
        path: '/opportunities',
        query: { goal_type: 'lending_capital', include_closed: true, limit: 500 },
    }),
)

// The template reads the loaded inputs through this, so nested refs are unwrapped.
const forecastInputs = computed(() => inputs.data.value)
const countedGoalNames = computed(() =>
    (forecastInputs.value?.include_goal_types ?? []).map(goalType => GOAL_TYPE_DETAILS[goalType].label).join(' and '),
)

const opportunityChoices = computed(() =>
    (inputs.data.value?.opportunities ?? [])
        .filter(opportunity => opportunity.stage !== 'lost' && opportunity.stage !== 'received')
        .map(opportunity => ({
            id: opportunity.id,
            label: `${opportunity.funder_name} · ${opportunity.name}${opportunity.expected_receipt_at ? '' : ' (no date)'}`,
        })),
)
const opportunityNames = computed(() => new Map(opportunityChoices.value.map(choice => [choice.id, choice.label])))
const plannedExpenseChoices = computed(() =>
    (inputs.data.value?.planned_expenses ?? []).map(expense => ({ id: expense.id, label: expense.label })),
)
const plannedExpenseNames = computed(
    () => new Map(plannedExpenseChoices.value.map(choice => [choice.id, choice.label])),
)
const scenarioItems = computed(() => [
    { label: 'New scenario', value: NEW_SCENARIO },
    ...(scenarioList.value?.data ?? []).map(scenario => ({ label: scenario.name, value: scenario.id })),
])
const selectedScenario = computed(
    () => scenarioList.value?.data.find(scenario => scenario.id === selectedScenarioId.value) ?? null,
)

watch(selectedScenarioId, scenarioId => {
    const scenario = scenarioList.value?.data.find(candidate => candidate.id === scenarioId)
    adjustments.value = scenario ? [...scenario.adjustments] : []
    scenarioName.value = scenario?.name ?? ''
})

const inflowColumns: TableColumn<ForecastInflow>[] = sortableColumns({
    columns: [
        {
            id: 'date',
            accessorFn: inflow => inflow.date,
            header: 'When',
            meta: { class: { td: 'whitespace-nowrap' } },
            cell: ({ row }) =>
                row.original.is_overdue
                    ? h('span', { class: 'text-error' }, 'Overdue')
                    : formatDate({ value: row.original.date }),
        },
        {
            id: 'label',
            accessorFn: inflow => inflow.label.toLowerCase(),
            header: 'From',
            cell: ({ row }) => h('span', { class: 'text-highlighted' }, row.original.label),
        },
        {
            id: 'committed_cents',
            accessorFn: inflow => inflow.committed_cents,
            header: 'Committed',
            meta: { class: { th: 'text-right', td: 'text-right' } },
            cell: ({ row }) =>
                row.original.committed_cents
                    ? formatMoney({ cents: row.original.committed_cents, compact: true })
                    : '—',
        },
        {
            id: 'weighted_cents',
            accessorFn: inflow => inflow.weighted_cents,
            header: 'Weighted',
            meta: { class: { th: 'text-right', td: 'text-right text-muted' } },
            cell: ({ row }) => formatMoney({ cents: row.original.weighted_cents, compact: true }),
        },
    ],
})

const comparison = computed(() => {
    if (!baseProjection.value) {
        return []
    }
    const rows = [
        {
            label: 'Committed money only',
            base: baseProjection.value.runway.committed,
            scenario: scenarioProjection.value?.runway.committed,
        },
        {
            label: 'Weighted pipeline',
            base: baseProjection.value.runway.weighted,
            scenario: scenarioProjection.value?.runway.weighted,
        },
    ]
    return rows
})

/**
 * Short runway text: "7.4 mo · Jun 12, 2027" or "24+ mo".
 *
 * @param input.end - Runway end.
 * @returns The text.
 */
function runwayText({ end }: { end: RunwayEnd | undefined }) {
    if (!end) {
        return '—'
    }
    return end.out_date ? `${end.months} mo · ${formatDate({ value: end.out_date })}` : '24+ mo'
}

const plannedExpensesCard = useTemplateRef<{
    openForm: (input: { plannedExpense: PlannedExpense | null }) => void
}>('plannedExpensesCard')

/**
 * Open a planned expense for editing (from the "What moves the line" list).
 *
 * @param input.plannedExpenseId - The expense.
 * @returns Resolves once the form is open.
 */
async function editPlannedExpense({ plannedExpenseId }: { plannedExpenseId: string }) {
    try {
        const plannedExpense = await api<PlannedExpense>({ path: `/planned-expenses/${plannedExpenseId}` })
        plannedExpensesCard.value?.openForm({ plannedExpense })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    }
}

/**
 * Remove one adjustment from the scenario.
 *
 * @param input.index - Its position.
 * @returns Nothing.
 */
function removeAdjustment({ index }: { index: number }) {
    adjustments.value = adjustments.value.filter((_, position) => position !== index)
}

/**
 * Save the scenario: update the selected one, or create a new one.
 *
 * @returns Resolves once saved.
 */
async function saveScenario() {
    if (!scenarioName.value.trim()) {
        toast.add({ title: 'Name the scenario first.', color: 'warning' })
        return
    }
    isSaving.value = true
    try {
        const body = { name: scenarioName.value, adjustments: adjustments.value }
        const saved = selectedScenario.value
            ? await api<Scenario>({ path: `/scenarios/${selectedScenario.value.id}`, method: 'PATCH', body })
            : await api<Scenario>({ path: '/scenarios', method: 'POST', body })
        await refreshScenarios()
        selectedScenarioId.value = saved.id
        toast.add({ title: 'Scenario saved', color: 'success' })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isSaving.value = false
    }
}

/**
 * Delete the selected scenario.
 *
 * @returns Resolves once deleted.
 */
async function deleteScenario() {
    if (!selectedScenario.value) {
        return
    }
    try {
        await api({ path: `/scenarios/${selectedScenario.value.id}`, method: 'DELETE' })
        selectedScenarioId.value = NEW_SCENARIO
        await refreshScenarios()
        toast.add({ title: 'Scenario deleted', color: 'success' })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    }
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Forecast">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UEmpty
                v-if="!isReady"
                icon="i-lucide-landmark"
                title="Add cash on hand to see the forecast"
                description="Connect Bookeeping.ai, or enter today's balance and monthly burn by hand."
                :actions="[{ label: 'Cash settings', to: '/settings/cash' }]"
            />

            <div v-else-if="baseProjection" class="grid gap-6 xl:grid-cols-[1fr_22rem]">
                <div class="min-w-0 space-y-6">
                    <UCard>
                        <template #header>
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h2 class="font-medium text-highlighted">Cash over the next 24 months</h2>
                                    <p class="text-xs text-muted">
                                        Starting at {{ formatMoney({ cents: forecastInputs?.starting_cash_cents }) }},
                                        burning {{ formatMoney({ cents: forecastInputs?.monthly_burn_cents }) }}/month.
                                        Counts
                                        {{ countedGoalNames }}
                                        money; lending capital goes into the lending structure.
                                    </p>
                                </div>
                            </div>
                        </template>
                        <ForecastRunwayChart
                            :projection="baseProjection"
                            :scenario-projection="scenarioProjection"
                            :height="340"
                        />
                    </UCard>

                    <UCard :ui="{ body: 'p-0 sm:p-0' }">
                        <template #header>
                            <h2 class="font-medium text-highlighted">What moves the line</h2>
                            <p class="text-xs text-muted">
                                Money landing and planned spending, in date order{{
                                    scenarioProjection ? ', including the scenario' : ''
                                }}. Hover the chart to see them month by month.
                            </p>
                        </template>
                        <ForecastEventList
                            :events="(scenarioProjection ?? baseProjection).events"
                            :limit="8"
                            @edit-planned-expense="plannedExpenseId => editPlannedExpense({ plannedExpenseId })"
                        />
                    </UCard>

                    <UCard>
                        <template #header>
                            <h2 class="font-medium text-highlighted">Lending capital</h2>
                            <p class="text-xs text-muted">
                                Not part of the cash runway (it goes into the lending structure). A longer timeline, by
                                quarter.
                            </p>
                        </template>
                        <ForecastLendingCapitalChart :opportunities="lendingOpportunities?.data ?? []" :height="240" />
                    </UCard>

                    <ForecastPlannedExpenses
                        ref="plannedExpensesCard"
                        :today="forecastInputs!.today"
                        @changed="inputs.refresh()"
                    />

                    <UCard :ui="{ body: 'p-0 sm:p-0' }">
                        <table class="w-full text-sm">
                            <thead class="text-left text-muted">
                                <tr class="border-b border-default">
                                    <th class="px-4 py-2 font-medium">Runway</th>
                                    <th class="px-4 py-2 font-medium">Today's plan</th>
                                    <th class="px-4 py-2 font-medium">With scenario</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="row in comparison"
                                    :key="row.label"
                                    class="border-b border-default last:border-0"
                                >
                                    <td class="px-4 py-2 text-highlighted">{{ row.label }}</td>
                                    <td class="px-4 py-2">{{ runwayText({ end: row.base }) }}</td>
                                    <td
                                        class="px-4 py-2"
                                        :class="row.scenario ? 'font-medium text-highlighted' : 'text-dimmed'"
                                    >
                                        {{ row.scenario ? runwayText({ end: row.scenario }) : 'Add a what-if →' }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </UCard>

                    <UCard :ui="{ body: 'p-0 sm:p-0' }">
                        <template #header>
                            <h2 class="font-medium text-highlighted">Money expected to land</h2>
                        </template>
                        <UTable
                            v-if="(scenarioProjection ?? baseProjection).inflows.length"
                            :data="(scenarioProjection ?? baseProjection).inflows"
                            :columns="inflowColumns"
                        />
                        <p v-else class="px-4 py-6 text-sm text-muted">
                            No dated pipeline money yet. Set "Expected to land" on opportunities to see it here.
                        </p>
                        <UAlert
                            v-if="baseProjection.undated.length"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-calendar-x"
                            class="m-4"
                            :title="`${baseProjection.undated.length} opportunities have no expected date`"
                            :description="`They're left out of the lines above: ${baseProjection.undated
                                .map(item => item.label)
                                .slice(0, 6)
                                .join('; ')}${baseProjection.undated.length > 6 ? '…' : ''}`"
                        />
                    </UCard>

                    <UCard v-if="baseProjection.markers.length" :ui="{ body: 'p-0 sm:p-0' }">
                        <template #header>
                            <h2 class="font-medium text-highlighted">Milestones on this timeline</h2>
                        </template>
                        <ul class="divide-y divide-default text-sm">
                            <li
                                v-for="marker in baseProjection.markers"
                                :key="marker.id"
                                class="flex justify-between px-4 py-2"
                            >
                                <span class="text-highlighted">{{ marker.title }}</span>
                                <span class="text-muted">{{ formatDate({ value: marker.date }) }}</span>
                            </li>
                        </ul>
                    </UCard>
                </div>

                <UCard class="self-start xl:sticky xl:top-4" :ui="{ body: 'space-y-4' }">
                    <template #header>
                        <h2 class="font-medium text-highlighted">Scenario</h2>
                        <p class="text-xs text-muted">
                            Try what-ifs; the chart updates as you go. Save to share with the team.
                        </p>
                    </template>

                    <USelect v-model="selectedScenarioId" :items="scenarioItems" class="w-full" />
                    <UInput v-model="scenarioName" placeholder="Name, e.g. UBS slips to Q2" class="w-full" />

                    <ul v-if="adjustments.length" class="space-y-2">
                        <li
                            v-for="(adjustment, index) in adjustments"
                            :key="index"
                            class="flex items-start gap-2 rounded-md border border-default p-2 text-sm"
                        >
                            <UIcon
                                :name="ADJUSTMENT_KIND_DETAILS[adjustment.kind].icon"
                                class="mt-0.5 size-4 shrink-0 text-muted"
                            />
                            <span class="flex-1">{{
                                describeAdjustment({ adjustment, opportunityNames, plannedExpenseNames })
                            }}</span>
                            <UButton
                                icon="i-lucide-x"
                                size="xs"
                                color="neutral"
                                variant="ghost"
                                aria-label="Remove what-if"
                                @click="removeAdjustment({ index })"
                            />
                        </li>
                    </ul>
                    <p v-else class="text-sm text-muted">No what-ifs yet.</p>

                    <USeparator />

                    <ForecastAdjustmentForm
                        :opportunities="opportunityChoices"
                        :planned-expenses="plannedExpenseChoices"
                        :today="forecastInputs!.today"
                        @add="adjustment => (adjustments = [...adjustments, adjustment])"
                    />

                    <USeparator />

                    <div class="flex gap-2">
                        <UButton
                            :label="selectedScenario ? 'Save changes' : 'Save scenario'"
                            variant="solid"
                            :loading="isSaving"
                            class="flex-1 justify-center"
                            @click="saveScenario"
                        />
                        <UButton
                            v-if="selectedScenario"
                            icon="i-lucide-trash-2"
                            color="error"
                            variant="ghost"
                            aria-label="Delete scenario"
                            @click="deleteScenario"
                        />
                    </div>
                </UCard>
            </div>
        </template>
    </UDashboardPanel>
</template>
