<script setup lang="ts">
import { CurveType } from 'nuxt-charts/enums'
import { computed, ref } from 'vue'
import type { GoalType } from '#shared/constants/pipeline.ts'
import type { RaisedEvent, RaisedOpportunity, RaisedPoint } from '#shared/forecast/project-raised.ts'
import { projectRaised } from '#shared/forecast/project-raised.ts'
import type { Goal } from '#shared/schemas/index.ts'
import { useChartPalette } from '~/composables/useChartPalette.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'

const props = defineProps<{
    today: string
    opportunities: RaisedOpportunity[]
    /** Goals, for the target line. */
    goals: Goal[]
    height?: number
}>()

const palette = useChartPalette()

// Grants (design grants and the OpEx they fund) and lending capital are raised on very different
// scales, so the chart shows one at a time.
type MoneyKind = 'grants' | 'lending'
const GOAL_TYPES_BY_KIND: Record<MoneyKind, GoalType[]> = {
    grants: ['design_grant', 'opex'],
    lending: ['lending_capital'],
}
const moneyKind = ref<MoneyKind>('grants')
const moneyKindItems = [
    { label: 'Grants', value: 'grants' },
    { label: 'Lending capital', value: 'lending' },
]

const projection = computed(() =>
    projectRaised({
        today: props.today,
        opportunities: props.opportunities,
        goalTypes: GOAL_TYPES_BY_KIND[moneyKind.value],
    }),
)

const targetCents = computed(() => {
    const targets = props.goals
        .filter(goal => GOAL_TYPES_BY_KIND[moneyKind.value].includes(goal.type))
        .map(goal => goal.target_amount_cents ?? 0)
    return targets.reduce((sum, cents) => sum + cents, 0)
})

// Each point on the x-axis: the months before today, today, then month ends. Money expected between today
// and the end of this month moves to next month's point, so "Today" isn't crowded by a point two days on.
const points = computed(() => {
    const all = projection.value.points
    const currentMonth = props.today.slice(0, 7)
    const shown: RaisedPoint[] = []
    let carried: RaisedEvent[] = []
    for (const point of all) {
        if (point.date > props.today && point.date.startsWith(currentMonth)) {
            carried = point.events
            continue
        }
        shown.push(carried.length ? { ...point, events: [...carried, ...point.events] } : point)
        carried = []
    }
    return shown
})
const todayIndex = computed(() => points.value.findIndex(point => point.date === props.today))

type ChartRow = {
    /** X-axis category: a month label, or "Today". */
    label: string
    date: string
    /** Received by then up to today, then the projection (drawn dotted). */
    projected: number
    /** The same values, drawn solid on top and cut off at today. */
    raised: number
    isFuture: boolean
    events: RaisedEvent[]
}

// Two lines with the same values, overlaid: the dotted one runs the whole way, and the solid one is
// drawn over it and clipped at today (see the style below), so it reads as one line that turns dotted.
// The chart library needs a value in every row for every line, so neither line can simply stop.
const rows = computed<ChartRow[]>(() =>
    points.value.map(point => {
        const dollars = (point.raised_cents ?? point.projected_cents ?? 0) / 100
        return {
            label: point.date === props.today ? 'Today' : monthLabel({ date: point.date }),
            date: point.date,
            projected: dollars,
            raised: dollars,
            isFuture: point.date > props.today,
            events: point.events,
        }
    }),
)

// Drawn in this order, so the solid line sits on top.
const categories = computed(() => ({
    projected: { name: 'Projected', color: palette.value.committed },
    raised: { name: 'Raised', color: palette.value.committed },
}))

// The share of the line, from its left end, that is solid: the points are evenly spaced, so today's
// position along the line is its index over the last index.
const solidLineInset = computed(() => {
    const lastIndex = rows.value.length - 1
    const solidShare = lastIndex > 0 && todayIndex.value >= 0 ? todayIndex.value / lastIndex : 1
    return `${((1 - solidShare) * 100).toFixed(3)}%`
})

const referenceLines = computed(() =>
    targetCents.value > 0
        ? [
              {
                  y: targetCents.value / 100,
                  color: palette.value.weighted,
                  strokeWidth: 1.5,
                  label: `Goal ${formatMoney({ cents: targetCents.value, compact: true })}`,
                  strokeDasharray: '2 4',
              },
              ...(todayIndex.value >= 0
                  ? [
                        {
                            x: 'Today',
                            color: palette.value.committed,
                            strokeWidth: 1,
                            strokeDasharray: '1 3',
                            label: 'Today',
                        },
                    ]
                  : []),
          ]
        : [],
)

const hasMoney = computed(() => projection.value.projected_cents > 0 || targetCents.value > 0)

const lastPoint = computed(() => projection.value.points.at(-1)!)
const EVENT_KIND_LABELS: Record<RaisedEvent['kind'], string> = {
    received: 'Received',
    approved: 'Approved',
    weighted: 'Weighted',
}

/**
 * Short month label for the x-axis, e.g. "Nov 26".
 *
 * @param input.date - YYYY-MM-DD.
 * @returns The label.
 */
function monthLabel({ date }: { date: string }) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
    })
}

/**
 * Tooltip title for a hovered row.
 *
 * @param row - The hovered row (the chart library's callback shape).
 * @returns "Today", or "End of Nov 30, 2026".
 */
function formatTooltipTitle(row: ChartRow) {
    return row.date === props.today ? 'Today' : `End of ${formatDate({ value: row.date })}`
}

/**
 * Y-axis label: compact dollars.
 *
 * @param tick - Dollar value (the chart library's callback shape).
 * @returns The label.
 */
function formatDollarTick(tick: number) {
    return formatMoney({ cents: tick * 100, compact: true })
}
</script>

<template>
    <div class="raised-chart space-y-2" :style="{ '--raised-chart-solid-inset': solidLineInset }">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-muted">
                <span class="font-semibold text-highlighted">{{
                    formatMoney({ cents: projection.raised_cents, compact: true })
                }}</span>
                raised<TermHint term="raised" /> ·
                <span class="font-semibold text-highlighted">{{
                    formatMoney({ cents: projection.projected_cents, compact: true })
                }}</span>
                projected by {{ formatDate({ value: lastPoint.date }) }}<TermHint term="raised_projected" />
            </p>
            <UTabs v-model="moneyKind" :items="moneyKindItems" :content="false" size="xs" variant="link" />
        </div>
        <p v-if="!hasMoney" class="py-10 text-center text-sm text-muted">
            No {{ moneyKind === 'grants' ? 'grant money' : 'lending capital' }} raised or expected yet. Amounts and
            expected dates on the pipeline's asks fill this chart.
        </p>
        <ClientOnly v-else>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span class="flex items-center gap-1.5">
                    <span class="inline-block h-0.5 w-4" :style="{ background: palette.committed }" />
                    Raised
                </span>
                <span class="flex items-center gap-1.5">
                    <span
                        class="inline-block h-0.5 w-4"
                        :style="{
                            background: `repeating-linear-gradient(90deg, ${palette.committed} 0 3px, transparent 3px 6px)`,
                        }"
                    />
                    Projected: approved asks plus the weighted pipeline<TermHint term="weighted_pipeline" />
                </span>
                <span v-if="targetCents > 0" class="flex items-center gap-1.5">
                    <span
                        class="inline-block h-0.5 w-4"
                        :style="{
                            background: `repeating-linear-gradient(90deg, ${palette.weighted} 0 2px, transparent 2px 6px)`,
                        }"
                    />
                    Goal
                </span>
            </div>
            <LineChart
                :data="rows"
                :categories="categories"
                x-axis="label"
                :height="height ?? 320"
                :y-formatter="formatDollarTick"
                :tooltip-title-formatter="formatTooltipTitle"
                :reference-lines="referenceLines"
                :line-width="2.5"
                :curve-type="CurveType.Linear"
                :x-num-ticks="8"
                :y-num-ticks="5"
                :y-grid-line="true"
                :x-grid-line="false"
                hide-legend
            >
                <template #tooltip="{ values }">
                    <div
                        v-if="values"
                        class="max-w-80 space-y-2 rounded-md border border-default bg-elevated p-3 text-sm shadow-lg"
                    >
                        <p class="font-medium text-highlighted">{{ formatTooltipTitle(values) }}</p>
                        <div class="flex items-center gap-2">
                            <span
                                class="size-2 shrink-0 rounded-full border-2"
                                :style="{
                                    borderColor: palette.committed,
                                    backgroundColor: values.isFuture ? 'transparent' : palette.committed,
                                }"
                            />
                            <span class="flex-1 text-muted">{{ values.isFuture ? 'Projected' : 'Raised' }}</span>
                            <span class="font-medium text-highlighted">{{
                                formatMoney({ cents: values.projected * 100, compact: true })
                            }}</span>
                        </div>
                        <div v-if="values.events.length" class="space-y-1 border-t border-default pt-2">
                            <p class="text-xs text-muted">{{ values.isFuture ? 'Expected' : 'Arrived' }}</p>
                            <div
                                v-for="event in values.events.slice(0, 5)"
                                :key="event.opportunity_id"
                                class="flex items-start justify-between gap-3"
                            >
                                <span class="min-w-0 text-highlighted">
                                    {{ event.label }}
                                    <span class="text-xs text-muted">
                                        · {{ EVENT_KIND_LABELS[event.kind] }}{{ event.is_overdue ? ', overdue' : '' }}
                                    </span>
                                </span>
                                <span class="shrink-0 text-right font-medium text-success">
                                    +{{ formatMoney({ cents: event.amount_cents, compact: true }) }}
                                </span>
                            </div>
                            <p v-if="values.events.length > 5" class="text-xs text-muted">
                                and {{ values.events.length - 5 }} more
                            </p>
                        </div>
                    </div>
                </template>
            </LineChart>
            <template #fallback>
                <USkeleton :style="{ height: `${height ?? 320}px` }" class="w-full" />
            </template>
        </ClientOnly>
        <p v-if="projection.undated.length" class="text-xs text-muted">
            {{ projection.undated.length }} open {{ projection.undated.length === 1 ? 'ask has' : 'asks have' }} no
            expected date, so {{ projection.undated.length === 1 ? "it isn't" : "they aren't" }} on the projected line
            ({{
                formatMoney({
                    cents: projection.undated.reduce((sum, ask) => sum + ask.weighted_cents, 0),
                    compact: true,
                })
            }}
            weighted).
        </p>
    </div>
</template>

<style scoped>
/* The chart library dashes every line or none, so the lines are styled here. The first line drawn is
   the projection, dotted the whole way. The second is the same line drawn solid on top, clipped at
   today: the inset is measured on the line's own box, which spans first point to last. */
.raised-chart :deep(.v-charts-line .v-charts-line-curve) {
    stroke-dasharray: 2 5;
    stroke-linecap: round;
}

.raised-chart :deep(.v-charts-line ~ .v-charts-line .v-charts-line-curve) {
    stroke-dasharray: none;
    clip-path: inset(-8px var(--raised-chart-solid-inset) -8px -8px);
}
</style>
