<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
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

// Drawn as plain SVG: the chart library drops rows with a missing value, so it can't end one line at
// today and start the dotted projection there.
const chartBox = ref<HTMLElement | null>(null)
const { width: boxWidth } = useElementSize(chartBox)
const MARGIN = { top: 16, right: 16, bottom: 28, left: 56 }
const chartHeight = computed(() => props.height ?? 320)
const plotWidth = computed(() => Math.max(boxWidth.value - MARGIN.left - MARGIN.right, 50))
const plotHeight = computed(() => chartHeight.value - MARGIN.top - MARGIN.bottom)

const points = computed(() => projection.value.points)
const todayIndex = computed(() => points.value.findIndex(point => point.date === props.today))

/**
 * The value a point shows: what was raised by then, or (after today) the projection.
 *
 * @param input.point - The point.
 * @returns Cents.
 */
function pointCents({ point }: { point: RaisedPoint }) {
    return point.raised_cents ?? point.projected_cents ?? 0
}

const yTicks = computed(() => {
    // At least $10K, so an empty chart still gets distinct ticks.
    const highest = Math.max(targetCents.value, ...points.value.map(point => pointCents({ point })), 1_000_000)
    return niceTicks({ maximum: highest, count: 5 })
})
const yMaximum = computed(() => yTicks.value.at(-1)!)

// Points sit at their dates (today is only days from the month ends around it).
const dayNumbers = computed(() => points.value.map(point => Date.parse(`${point.date}T00:00:00Z`) / 86_400_000))

/**
 * Horizontal position of a point, by its date.
 *
 * @param input.index - The point's index.
 * @returns x in pixels within the plot.
 */
function xFor({ index }: { index: number }) {
    const days = dayNumbers.value
    const span = days.at(-1)! - days[0]!
    return span > 0 ? ((days[index]! - days[0]!) / span) * plotWidth.value : plotWidth.value / 2
}

/**
 * Vertical position of an amount.
 *
 * @param input.cents - The amount.
 * @returns y in pixels within the plot.
 */
function yFor({ cents }: { cents: number }) {
    return plotHeight.value - (cents / yMaximum.value) * plotHeight.value
}

/**
 * An SVG path through some points.
 *
 * @param input.indexes - Point indexes, in order.
 * @returns The path's `d`, or '' for fewer than two points.
 */
function pathThrough({ indexes }: { indexes: number[] }) {
    if (indexes.length < 2) {
        return ''
    }
    return indexes
        .map((index, position) => {
            const command = position === 0 ? 'M' : 'L'
            return `${command}${xFor({ index }).toFixed(1)},${yFor({ cents: pointCents({ point: points.value[index]! }) }).toFixed(1)}`
        })
        .join(' ')
}

const raisedPath = computed(() =>
    pathThrough({ indexes: points.value.flatMap((point, index) => (point.raised_cents !== null ? [index] : [])) }),
)
const projectedPath = computed(() =>
    pathThrough({
        indexes: points.value.flatMap((point, index) => (point.projected_cents !== null ? [index] : [])),
    }),
)
// About eight month labels, always including today, none crowding it.
const xLabels = computed(() => {
    const step = Math.max(1, Math.ceil(points.value.length / 8))
    const todayX = todayIndex.value >= 0 ? xFor({ index: todayIndex.value }) : -Infinity
    const minimumGap = plotWidth.value / 12
    return points.value.flatMap((point, index) => {
        const isToday = index === todayIndex.value
        const isNearToday = Math.abs(xFor({ index }) - todayX) < minimumGap
        if (!isToday && (index % step !== 0 || isNearToday)) {
            return []
        }
        return [{ index, label: isToday ? 'Today' : monthLabel({ date: point.date }) }]
    })
})

/**
 * How an x-axis label lines up with its point: labels near the edges stay inside the chart.
 *
 * @param input.index - The point's index.
 * @returns `start`, `middle` or `end`.
 */
function labelAnchor({ index }: { index: number }) {
    const x = xFor({ index })
    return x < 24 ? 'start' : x > plotWidth.value - 24 ? 'end' : 'middle'
}

const hasMoney = computed(() => projection.value.projected_cents > 0 || targetCents.value > 0)

const hoveredIndex = ref<number | null>(null)
const hoveredPoint = computed(() => (hoveredIndex.value === null ? null : points.value[hoveredIndex.value]!))

/**
 * Follow the pointer to the nearest month.
 *
 * @param event - The pointer event over the plot.
 * @returns Nothing.
 */
function trackPointer(event: PointerEvent) {
    const bounds = (event.currentTarget as SVGElement).getBoundingClientRect()
    const x = event.clientX - bounds.left - MARGIN.left
    let nearest = 0
    points.value.forEach((_point, index) => {
        if (Math.abs(xFor({ index }) - x) < Math.abs(xFor({ index: nearest }) - x)) {
            nearest = index
        }
    })
    hoveredIndex.value = nearest
}

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
 * Tooltip title for a point.
 *
 * @param input.point - The hovered point.
 * @returns "Today", or "End of Nov 30, 2026".
 */
function tooltipTitle({ point }: { point: RaisedPoint }) {
    return point.date === props.today ? 'Today' : `End of ${formatDate({ value: point.date })}`
}

/**
 * Round axis ticks from 0 up past the highest value: steps of 1, 2, 2.5 or 5 × a power of ten.
 *
 * @param input.maximum - Highest value to cover (cents).
 * @param input.count - About how many steps.
 * @returns Tick values in cents, starting at 0.
 */
function niceTicks({ maximum, count }: { maximum: number; count: number }) {
    const rough = maximum / count
    const power = 10 ** Math.floor(Math.log10(rough))
    const step = [1, 2, 2.5, 5, 10].map(factor => factor * power).find(candidate => candidate >= rough)!
    const ticks: number[] = []
    for (let tick = 0; tick < maximum + step; tick += step) {
        ticks.push(tick)
        if (tick >= maximum) {
            break
        }
    }
    return ticks
}
</script>

<template>
    <div class="raised-chart space-y-2">
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
        <div v-if="hasMoney" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
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
        <p v-if="!hasMoney" class="py-10 text-center text-sm text-muted">
            No {{ moneyKind === 'grants' ? 'grant money' : 'lending capital' }} raised or expected yet. Amounts and
            expected dates on the pipeline's asks fill this chart.
        </p>
        <div v-else ref="chartBox" class="relative w-full" :style="{ height: `${chartHeight}px` }">
            <svg
                v-if="boxWidth > 0"
                :width="boxWidth"
                :height="chartHeight"
                class="raised-chart__plot block"
                role="img"
                :aria-label="`Money raised: ${formatMoney({ cents: projection.raised_cents, compact: true })} so far, ${formatMoney({ cents: projection.projected_cents, compact: true })} projected by ${formatDate({ value: lastPoint.date })}`"
                @pointermove="trackPointer"
                @pointerleave="hoveredIndex = null"
            >
                <g :transform="`translate(${MARGIN.left},${MARGIN.top})`">
                    <g v-for="tick in yTicks" :key="tick">
                        <line
                            :x1="0"
                            :x2="plotWidth"
                            :y1="yFor({ cents: tick })"
                            :y2="yFor({ cents: tick })"
                            class="raised-chart__grid"
                        />
                        <text
                            :x="-8"
                            :y="yFor({ cents: tick })"
                            dy="0.32em"
                            text-anchor="end"
                            class="raised-chart__tick"
                        >
                            {{ formatMoney({ cents: tick, compact: true }) }}
                        </text>
                    </g>
                    <text
                        v-for="label in xLabels"
                        :key="label.index"
                        :x="xFor({ index: label.index })"
                        :y="plotHeight + 18"
                        :text-anchor="labelAnchor({ index: label.index })"
                        class="raised-chart__tick"
                    >
                        {{ label.label }}
                    </text>
                    <line
                        v-if="todayIndex >= 0"
                        :x1="xFor({ index: todayIndex })"
                        :x2="xFor({ index: todayIndex })"
                        :y1="0"
                        :y2="plotHeight"
                        class="raised-chart__today"
                    />
                    <g v-if="targetCents > 0">
                        <line
                            :x1="0"
                            :x2="plotWidth"
                            :y1="yFor({ cents: targetCents })"
                            :y2="yFor({ cents: targetCents })"
                            :stroke="palette.weighted"
                            stroke-width="1.5"
                            stroke-dasharray="2 4"
                        />
                        <text
                            :x="4"
                            :y="yFor({ cents: targetCents }) - 6"
                            class="raised-chart__tick"
                            :style="{ fill: palette.weighted }"
                        >
                            Goal {{ formatMoney({ cents: targetCents, compact: true }) }}
                        </text>
                    </g>
                    <path :d="raisedPath" fill="none" :stroke="palette.committed" stroke-width="2.5" />
                    <path
                        :d="projectedPath"
                        fill="none"
                        :stroke="palette.committed"
                        stroke-width="2.5"
                        stroke-dasharray="2 5"
                        stroke-linecap="round"
                    />
                    <circle
                        v-if="todayIndex >= 0"
                        :cx="xFor({ index: todayIndex })"
                        :cy="yFor({ cents: pointCents({ point: points[todayIndex]! }) })"
                        r="4"
                        :fill="palette.committed"
                    />
                    <g v-if="hoveredPoint && hoveredIndex !== null">
                        <line
                            :x1="xFor({ index: hoveredIndex })"
                            :x2="xFor({ index: hoveredIndex })"
                            :y1="0"
                            :y2="plotHeight"
                            class="raised-chart__guide"
                        />
                        <circle
                            :cx="xFor({ index: hoveredIndex })"
                            :cy="yFor({ cents: pointCents({ point: hoveredPoint }) })"
                            r="4.5"
                            :fill="hoveredPoint.raised_cents !== null ? palette.committed : 'var(--ui-bg)'"
                            :stroke="palette.committed"
                            stroke-width="2"
                        />
                    </g>
                    <rect :width="plotWidth" :height="plotHeight" fill="transparent" />
                </g>
            </svg>
            <div
                v-if="hoveredPoint && hoveredIndex !== null"
                class="pointer-events-none absolute top-2 z-10 w-72 space-y-2 rounded-md border border-default bg-elevated p-3 text-sm shadow-lg"
                :style="
                    xFor({ index: hoveredIndex }) > plotWidth / 2
                        ? { right: `${boxWidth - MARGIN.left - xFor({ index: hoveredIndex }) + 12}px` }
                        : { left: `${MARGIN.left + xFor({ index: hoveredIndex }) + 12}px` }
                "
            >
                <p class="font-medium text-highlighted">{{ tooltipTitle({ point: hoveredPoint }) }}</p>
                <div class="flex items-center gap-2">
                    <span
                        class="size-2 shrink-0 rounded-full border-2"
                        :style="{
                            borderColor: palette.committed,
                            backgroundColor: hoveredPoint.raised_cents !== null ? palette.committed : 'transparent',
                        }"
                    />
                    <span class="flex-1 text-muted">{{
                        hoveredPoint.raised_cents !== null ? 'Raised' : 'Projected'
                    }}</span>
                    <span class="font-medium text-highlighted">{{
                        formatMoney({ cents: pointCents({ point: hoveredPoint }), compact: true })
                    }}</span>
                </div>
                <div v-if="hoveredPoint.events.length" class="space-y-1 border-t border-default pt-2">
                    <p class="text-xs text-muted">{{ hoveredPoint.raised_cents !== null ? 'Arrived' : 'Expected' }}</p>
                    <div
                        v-for="event in hoveredPoint.events.slice(0, 5)"
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
                    <p v-if="hoveredPoint.events.length > 5" class="text-xs text-muted">
                        and {{ hoveredPoint.events.length - 5 }} more
                    </p>
                </div>
            </div>
        </div>
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
.raised-chart__grid {
    stroke: var(--ui-border);
    stroke-dasharray: 3 3;
}

.raised-chart__tick {
    fill: var(--ui-text-muted);
    font-size: 12px;
}

.raised-chart__today {
    stroke: var(--ui-border-accented);
}

.raised-chart__guide {
    stroke: var(--ui-text-dimmed);
    stroke-dasharray: 2 2;
}
</style>
