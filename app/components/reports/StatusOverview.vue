<script setup lang="ts">
import { computed } from 'vue'
import type { OpportunityStage } from '#shared/constants/pipeline.ts'
import { OPPORTUNITY_STAGE_DETAILS, OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'
import type { Opportunity } from '#shared/schemas/index.ts'
import { useStageColors } from '~/composables/useChartPalette.ts'
import { formatMoney } from '~/utils/format.ts'

const props = defineProps<{ opportunities: Opportunity[] }>()
const stageColors = useStageColors()

// Furthest along first, as the team reads the pipeline. Declined asks are left out of the pie and
// the funder bars; their total is on its own tile.
const STAGES_BY_PROGRESS = [...OPPORTUNITY_STAGES].filter(stage => stage !== 'lost').reverse()

const rows = computed(() =>
    OPPORTUNITY_STAGES.map(stage => {
        const atStage = props.opportunities.filter(opportunity => opportunity.stage === stage)
        return {
            stage,
            count: atStage.length,
            amount: atStage.reduce((sum, opportunity) => sum + (opportunity.amount_cents ?? 0), 0),
            weighted: atStage.reduce((sum, opportunity) => sum + opportunity.weighted_amount_cents, 0),
        }
    }),
)

const totals = computed(() => {
    const sum = (stages: string[], key: 'amount' | 'weighted' | 'count') =>
        rows.value.filter(row => stages.includes(row.stage)).reduce((total, row) => total + row[key], 0)
    const open = OPPORTUNITY_STAGES.filter(stage => OPPORTUNITY_STAGE_DETAILS[stage].isOpen)
    return [
        { label: 'Open pipeline', amount: sum(open, 'amount'), count: sum(open, 'count'), color: 'text-highlighted' },
        { label: 'Weighted', amount: sum(open, 'weighted'), count: sum(open, 'count'), color: 'text-highlighted' },
        {
            label: 'Approved',
            amount: sum(['committed'], 'amount'),
            count: sum(['committed'], 'count'),
            color: 'text-success',
        },
        {
            label: 'Received',
            amount: sum(['received'], 'amount'),
            count: sum(['received'], 'count'),
            color: 'text-primary',
        },
        { label: 'Declined', amount: sum(['lost'], 'amount'), count: sum(['lost'], 'count'), color: 'text-muted' },
    ]
})

// Pie slices: stages holding money, furthest along first.
const slices = computed(() =>
    STAGES_BY_PROGRESS.map(stage => rows.value.find(row => row.stage === stage)!).filter(row => row.amount > 0),
)
const pieTotal = computed(() => slices.value.reduce((sum, slice) => sum + slice.amount, 0))
const pieCategories = computed(() =>
    Object.fromEntries(
        slices.value.map(slice => [
            slice.stage,
            { name: OPPORTUNITY_STAGE_DETAILS[slice.stage].label, color: stageColors.value[slice.stage] },
        ]),
    ),
)

// Funder bars, grouped by stage; asks without an amount are listed as "Amount TBD".
const groups = computed(() =>
    STAGES_BY_PROGRESS.map(stage => {
        const asks = props.opportunities
            .filter(opportunity => opportunity.stage === stage)
            .sort((first, second) => (second.amount_cents ?? -1) - (first.amount_cents ?? -1))
        return {
            stage,
            total: asks.reduce((sum, opportunity) => sum + (opportunity.amount_cents ?? 0), 0),
            asks,
        }
    }).filter(group => group.asks.length > 0),
)
const largestAsk = computed(() => Math.max(1, ...props.opportunities.map(opportunity => opportunity.amount_cents ?? 0)))

/**
 * A stage's share of the pie, as a whole percentage.
 *
 * @param input.amount - The stage's amount in cents.
 * @returns e.g. "42%".
 */
function shareOfTotal({ amount }: { amount: number }) {
    return `${Math.round((amount / pieTotal.value) * 100)}%`
}

/**
 * Bar width for an ask, relative to the largest ask on the page.
 *
 * @param input.amount - The ask in cents.
 * @returns A CSS width.
 */
function barWidth({ amount }: { amount: number }) {
    return `${Math.max(1, (amount / largestAsk.value) * 100)}%`
}

/**
 * Funder name, plus the ask's name when a funder has more than one ask in the list.
 *
 * @param input.opportunity - The ask.
 * @returns The row label.
 */
function askLabel({ opportunity }: { opportunity: Opportunity }) {
    const hasSeveral =
        props.opportunities.filter(other => other.funder.id === opportunity.funder.id && other.stage !== 'lost')
            .length > 1
    return hasSeveral ? `${opportunity.funder.name} · ${opportunity.name}` : opportunity.funder.name
}

/**
 * A stage's display name.
 *
 * @param input.stage - The stage.
 * @returns e.g. "Approved".
 */
function stageLabel({ stage }: { stage: OpportunityStage }) {
    return OPPORTUNITY_STAGE_DETAILS[stage].label
}
</script>

<template>
    <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <UCard v-for="total in totals" :key="total.label">
                <p class="text-sm text-muted">{{ total.label }}</p>
                <p class="mt-1 text-2xl font-semibold" :class="total.color">
                    {{ formatMoney({ cents: total.amount, compact: true }) }}
                </p>
                <p class="text-xs text-muted">{{ total.count }} ask{{ total.count === 1 ? '' : 's' }}</p>
            </UCard>
        </div>

        <UCard>
            <template #header>
                <h2 class="font-medium text-highlighted">Where the money stands</h2>
                <p class="text-xs text-muted">
                    Everything asked for, by stage. Declined asks are left out; asks without an amount don't count.
                </p>
            </template>
            <div v-if="slices.length" class="grid items-center gap-6 md:grid-cols-2">
                <ClientOnly>
                    <DonutChart
                        :data="slices.map(slice => slice.amount)"
                        :categories="pieCategories"
                        :height="260"
                        :arc-width="36"
                        :pad-angle="0.02"
                        hide-legend
                        hide-tooltip
                    >
                        <div class="text-center">
                            <p class="text-xs text-muted">Total</p>
                            <p class="text-2xl font-semibold text-highlighted">
                                {{ formatMoney({ cents: pieTotal, compact: true }) }}
                            </p>
                        </div>
                    </DonutChart>
                    <template #fallback><USkeleton class="mx-auto size-65 rounded-full" /></template>
                </ClientOnly>
                <ul class="space-y-2 text-sm">
                    <li v-for="slice in slices" :key="slice.stage" class="flex items-center gap-3">
                        <span
                            class="size-3 shrink-0 rounded-sm"
                            :style="{ backgroundColor: stageColors[slice.stage] }"
                        />
                        <span class="flex-1 text-highlighted">{{ stageLabel({ stage: slice.stage }) }}</span>
                        <span class="w-12 text-right text-muted">{{ shareOfTotal({ amount: slice.amount }) }}</span>
                        <span class="w-20 text-right font-medium text-highlighted">
                            {{ formatMoney({ cents: slice.amount, compact: true }) }}
                        </span>
                        <span class="w-16 text-right text-xs text-muted">
                            {{ slice.count }} ask{{ slice.count === 1 ? '' : 's' }}
                        </span>
                    </li>
                </ul>
            </div>
            <p v-else class="text-sm text-muted">No asks with an amount yet.</p>
        </UCard>

        <UCard>
            <template #header>
                <h2 class="font-medium text-highlighted">Funders by stage</h2>
                <p class="text-xs text-muted">Each ask's amount, grouped by where it stands.</p>
            </template>
            <div class="space-y-6">
                <section v-for="group in groups" :key="group.stage" class="space-y-2">
                    <h3 class="flex items-center gap-2 text-sm font-semibold tracking-wide text-highlighted uppercase">
                        <span class="size-3 rounded-sm" :style="{ backgroundColor: stageColors[group.stage] }" />
                        {{ stageLabel({ stage: group.stage }) }}
                        <span class="font-normal text-muted">
                            · {{ formatMoney({ cents: group.total, compact: true }) }}
                        </span>
                    </h3>
                    <div
                        v-for="opportunity in group.asks"
                        :key="opportunity.id"
                        class="grid grid-cols-[minmax(8rem,14rem)_1fr] items-center gap-3 text-sm"
                    >
                        <NuxtLink
                            :to="`/pipeline/funders/${opportunity.funder.id}`"
                            class="truncate text-highlighted hover:underline"
                        >
                            {{ askLabel({ opportunity }) }}
                        </NuxtLink>
                        <div v-if="opportunity.amount_cents" class="flex items-center gap-2">
                            <div
                                class="h-5 rounded-sm"
                                :style="{
                                    width: barWidth({ amount: opportunity.amount_cents }),
                                    backgroundColor: stageColors[group.stage],
                                }"
                            />
                            <span class="shrink-0 font-medium text-highlighted">
                                {{ formatMoney({ cents: opportunity.amount_cents, compact: true }) }}
                            </span>
                        </div>
                        <span v-else class="text-xs text-muted italic">Amount TBD</span>
                    </div>
                </section>
                <p v-if="!groups.length" class="text-sm text-muted">No open or approved asks.</p>
            </div>
        </UCard>
    </div>
</template>
