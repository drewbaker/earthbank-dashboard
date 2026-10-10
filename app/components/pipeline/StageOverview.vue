<script setup lang="ts">
import { computed } from 'vue'
import type { OpportunityStage } from '#shared/constants/pipeline.ts'
import { OPPORTUNITY_STAGE_DETAILS, OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'
import { useStageColors } from '~/composables/useChartPalette.ts'
import type { StageAsk } from '~/utils/stage-asks.ts'
import { formatMoney } from '~/utils/format.ts'

// `part` lets a page place the funder bars and the donut separately (Pipeline puts the donut beside
// the goal stats and the bars below); the default shows both side by side.
const props = withDefaults(defineProps<{ asks: StageAsk[]; part?: 'both' | 'bars' | 'pie' }>(), { part: 'both' })
const stageColors = useStageColors()

// Furthest along first, as the team reads the pipeline. Declined asks are left out.
const STAGES_BY_PROGRESS = [...OPPORTUNITY_STAGES].filter(stage => stage !== 'lost').reverse()

// A long early stage stays readable: the biggest asks get bars, the rest are summed in one line.
const MAX_BARS_PER_STAGE = 6

const groups = computed(() =>
    STAGES_BY_PROGRESS.map(stage => {
        const asks = props.asks.filter(ask => ask.stage === stage)
        const priced = asks
            .filter(ask => (ask.amount_cents ?? 0) > 0)
            .sort((first, second) => second.amount_cents! - first.amount_cents!)
        const hidden = priced.slice(MAX_BARS_PER_STAGE)
        return {
            stage,
            total: priced.reduce((sum, ask) => sum + ask.amount_cents!, 0),
            count: asks.length,
            shown: priced.slice(0, MAX_BARS_PER_STAGE),
            hiddenCount: hidden.length,
            hiddenTotal: hidden.reduce((sum, ask) => sum + ask.amount_cents!, 0),
            unpriced: asks.filter(ask => !ask.amount_cents),
        }
    }).filter(group => group.count > 0),
)

const slices = computed(() => groups.value.filter(group => group.total > 0))
const pieTotal = computed(() => slices.value.reduce((sum, slice) => sum + slice.total, 0))
const pieCategories = computed(() =>
    Object.fromEntries(
        slices.value.map(slice => [
            slice.stage,
            { name: stageLabel({ stage: slice.stage }), color: stageColors.value[slice.stage] },
        ]),
    ),
)
const largestAsk = computed(() =>
    Math.max(1, ...props.asks.filter(ask => ask.stage !== 'lost').map(ask => ask.amount_cents ?? 0)),
)

/**
 * A stage's display name.
 *
 * @param input.stage - The stage.
 * @returns e.g. "Approved".
 */
function stageLabel({ stage }: { stage: OpportunityStage }) {
    return OPPORTUNITY_STAGE_DETAILS[stage].label
}

/**
 * Bar width for an ask, relative to the largest ask shown.
 *
 * @param input.amount - The ask in cents.
 * @returns A CSS width.
 */
function barWidth({ amount }: { amount: number }) {
    return `${Math.max(1, (amount / largestAsk.value) * 100)}%`
}

/**
 * A stage's share of the total, as a whole percentage.
 *
 * @param input.amount - The stage's amount in cents.
 * @returns e.g. "42%".
 */
function shareOfTotal({ amount }: { amount: number }) {
    return `${Math.round((amount / pieTotal.value) * 100)}%`
}
</script>

<template>
    <UCard v-if="groups.length" :ui="{ body: 'p-4 sm:p-5' }">
        <div class="grid gap-6" :class="{ 'lg:grid-cols-[minmax(0,1fr)_18rem]': part === 'both' }">
            <div v-if="part !== 'pie'" class="space-y-4">
                <section v-for="group in groups" :key="group.stage" class="space-y-1">
                    <h3 class="flex items-center gap-2 text-xs font-semibold tracking-wide text-highlighted uppercase">
                        <span class="size-2.5 rounded-sm" :style="{ backgroundColor: stageColors[group.stage] }" />
                        {{ stageLabel({ stage: group.stage }) }}
                        <span v-if="group.total" class="font-normal text-muted">
                            · {{ formatMoney({ cents: group.total, compact: true }) }}
                        </span>
                    </h3>
                    <div
                        v-for="ask in group.shown"
                        :key="ask.key"
                        class="grid grid-cols-[minmax(7rem,13rem)_1fr] items-center gap-3 text-sm"
                    >
                        <NuxtLink v-if="ask.url" :to="ask.url" class="truncate text-default hover:underline">
                            {{ ask.label }}
                        </NuxtLink>
                        <span v-else class="truncate text-default">{{ ask.label }}</span>
                        <div class="flex items-center gap-2">
                            <div
                                class="h-3.5 rounded-sm"
                                :style="{
                                    width: barWidth({ amount: ask.amount_cents! }),
                                    backgroundColor: stageColors[group.stage],
                                }"
                            />
                            <span class="shrink-0 text-xs font-medium text-highlighted">
                                {{ formatMoney({ cents: ask.amount_cents!, compact: true }) }}
                            </span>
                        </div>
                    </div>
                    <p v-if="group.hiddenCount" class="text-xs text-muted">
                        + {{ group.hiddenCount }} more ({{ formatMoney({ cents: group.hiddenTotal, compact: true }) }})
                    </p>
                    <p v-if="group.unpriced.length" class="text-xs text-muted">
                        <span class="italic">Amount TBD:</span>
                        {{ group.unpriced.map(ask => ask.organization).join(' · ') }}
                    </p>
                </section>
            </div>

            <div
                v-if="part !== 'bars' && slices.length"
                class="space-y-3"
                :class="
                    part === 'pie'
                        ? 'grid items-center gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]'
                        : 'lg:sticky lg:top-4 lg:self-start'
                "
            >
                <ClientOnly>
                    <DonutChart
                        :data="slices.map(slice => slice.total)"
                        :categories="pieCategories"
                        :height="200"
                        :arc-width="28"
                        :pad-angle="0.02"
                        hide-legend
                        hide-tooltip
                    >
                        <div class="text-center">
                            <p class="text-xs text-muted">Total</p>
                            <p class="text-xl font-semibold text-highlighted">
                                {{ formatMoney({ cents: pieTotal, compact: true }) }}
                            </p>
                        </div>
                    </DonutChart>
                    <template #fallback><USkeleton class="mx-auto size-50 rounded-full" /></template>
                </ClientOnly>
                <ul class="space-y-1 text-sm">
                    <li v-for="slice in slices" :key="slice.stage" class="flex items-center gap-2">
                        <span
                            class="size-2.5 shrink-0 rounded-sm"
                            :style="{ backgroundColor: stageColors[slice.stage] }"
                        />
                        <span class="flex-1 text-default">{{ stageLabel({ stage: slice.stage }) }}</span>
                        <span class="w-10 text-right text-xs text-muted">{{
                            shareOfTotal({ amount: slice.total })
                        }}</span>
                        <span class="w-16 text-right font-medium text-highlighted">
                            {{ formatMoney({ cents: slice.total, compact: true }) }}
                        </span>
                    </li>
                </ul>
            </div>
        </div>
    </UCard>
</template>
