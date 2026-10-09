<script setup lang="ts">
import { CurveType } from 'nuxt-charts/enums'
import { computed } from 'vue'
import type { ForecastEvent, RunwayEnd, RunwayProjection } from '#shared/forecast/project-runway.ts'
import { useChartPalette } from '~/composables/useChartPalette.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'

const props = defineProps<{
    projection: RunwayProjection
    /** A scenario projection to draw (dashed) on top of the base lines. */
    scenarioProjection?: RunwayProjection | null
    height?: number
    /** Leave out the weighted line (compact Overview chart). */
    committedOnly?: boolean
}>()

const palette = useChartPalette()

type SeriesKey = 'committed' | 'weighted' | 'scenario'
type ChartRow = {
    /** X-axis category: "Today", then one month label per point ("Nov 26"). */
    label: string
    date: string
    committed: number
    weighted?: number
    scenario?: number
    events: ForecastEvent[]
}

const lineValues = computed(() => {
    const points = props.projection.points
    const values: Partial<Record<SeriesKey, number[]>> = {
        committed: points.map(point => point.committed_cents / 100),
    }
    if (!props.committedOnly) {
        values.weighted = points.map(point => point.weighted_cents / 100)
    }
    if (props.scenarioProjection) {
        values.scenario = props.scenarioProjection.points.map(point => point.weighted_cents / 100)
    }
    return values
})

const rows = computed<ChartRow[]>(() =>
    props.projection.points.map((point, index) => {
        const row: ChartRow = {
            label: index === 0 ? 'Today' : monthLabel({ date: point.date }),
            date: point.date,
            committed: lineValues.value.committed![index]!,
            // With a scenario, its events include the plan's plus the what-ifs.
            events: (props.scenarioProjection ?? props.projection).points[index]!.events,
        }
        for (const key of ['weighted', 'scenario'] as SeriesKey[]) {
            const values = lineValues.value[key]
            if (values) {
                row[key] = values[index]!
            }
        }
        return row
    }),
)

const hasDeficit = computed(() => Object.values(lineValues.value).some(values => values?.some(value => value < 0)))

// Series are drawn in this order: weighted, then committed (so it stays visible where the two are equal,
// before pipeline money lands), then the scenario.
const categories = computed(() => ({
    ...(props.committedOnly ? {} : { weighted: { name: 'Weighted pipeline', color: palette.value.weighted } }),
    committed: { name: 'Committed money only', color: palette.value.committed },
    ...(props.scenarioProjection ? { scenario: { name: 'Scenario (weighted)', color: palette.value.scenario } } : {}),
}))

// Our own legend, committed first, plus the $0 threshold when cash runs out.
const legend = computed(() => [
    { key: 'committed', name: 'Committed money only', color: palette.value.committed, isDashed: false },
    ...(props.committedOnly
        ? []
        : [{ key: 'weighted', name: 'Weighted pipeline', color: palette.value.weighted, isDashed: false }]),
    ...(props.scenarioProjection
        ? [{ key: 'scenario', name: 'Scenario (weighted)', color: palette.value.scenario, isDashed: false }]
        : []),
    ...(hasDeficit.value
        ? [{ key: 'below', name: '$0: out of cash', color: palette.value.deficit, isDashed: true }]
        : []),
])

// Tooltip rows, committed first.
const tooltipSeries = computed(
    () => legend.value.filter(item => item.key !== 'below') as { key: SeriesKey; name: string; color: string }[],
)

// The $0 line, styled like an alert threshold, plus a dashed marker at the month each line first drops
// below it. (The run-out dates themselves are on the runway tiles; a long label here would cross the lines.)
const referenceLines = computed(() => {
    const ends: { name: string; end: RunwayEnd | undefined }[] = [
        { name: 'committed', end: props.projection.runway.committed },
        ...(props.committedOnly ? [] : [{ name: 'weighted', end: props.projection.runway.weighted }]),
        ...(props.scenarioProjection ? [{ name: 'scenario', end: props.scenarioProjection.runway.weighted }] : []),
    ].filter(({ end }) => end?.out_date)
    const lines: {
        x?: string
        y?: number
        color: string
        strokeWidth: number
        label?: string
        strokeDasharray?: string
    }[] = [
        {
            y: 0,
            color: palette.value.deficit,
            strokeWidth: 1.5,
            label: 'Out of cash',
            strokeDasharray: '6 4',
        },
    ]
    const months = new Set(ends.flatMap(({ end }) => rows.value.find(row => row.date >= end!.out_date!)?.label ?? []))
    for (const month of months) {
        lines.push({ x: month, color: palette.value.deficit, strokeWidth: 1, strokeDasharray: '3 3' })
    }
    return lines
})

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
 * Compact dollars, with a proper minus sign for negatives.
 *
 * @param input.dollars - Amount in dollars.
 * @returns e.g. "$200K" or "−$36K".
 */
function compactDollars({ dollars }: { dollars: number }) {
    const text = formatMoney({ cents: Math.abs(dollars) * 100, compact: true })
    return dollars < 0 ? `−${text}` : text
}

/**
 * Y-axis label: compact dollars.
 *
 * @param tick - Dollar value.
 * @returns The label.
 */
function formatDollarTick(tick: number) {
    return compactDollars({ dollars: tick })
}

/**
 * Tooltip title for a hovered row.
 *
 * @param row - The hovered data row.
 * @returns The date.
 */
function formatTooltipTitle(row: ChartRow) {
    return row.date === props.projection.today ? 'Today' : `End of ${formatDate({ value: row.date })}`
}
</script>

<template>
    <ClientOnly>
        <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span v-for="item in legend" :key="item.key" class="flex items-center gap-1.5">
                <span
                    class="inline-block h-0.5 w-4"
                    :style="{
                        background: item.isDashed
                            ? `repeating-linear-gradient(90deg, ${item.color} 0 4px, transparent 4px 7px)`
                            : item.color,
                    }"
                />
                {{ item.name }}
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
            :line-width="2"
            :curve-type="CurveType.Linear"
            :x-num-ticks="8"
            :y-num-ticks="6"
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
                    <div v-for="series in tooltipSeries" :key="series.key" class="flex items-center gap-2">
                        <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: series.color }" />
                        <span class="flex-1 text-muted">{{ series.name }}</span>
                        <span
                            class="font-medium"
                            :class="(values[series.key] ?? 0) < 0 ? 'text-error' : 'text-highlighted'"
                        >
                            {{ compactDollars({ dollars: values[series.key] ?? 0 }) }}
                        </span>
                    </div>
                    <div v-if="values.events.length" class="space-y-1 border-t border-default pt-2">
                        <p class="text-xs text-muted">What changed this month</p>
                        <div
                            v-for="(event, index) in values.events.slice(0, 5)"
                            :key="index"
                            class="flex items-start justify-between gap-3"
                        >
                            <span class="min-w-0 text-highlighted">{{ event.label }}</span>
                            <ForecastEventAmount :event="event" class="text-right" />
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
</template>
