<script setup lang="ts">
import { computed } from 'vue'
import type { ForecastEvent, RunwayProjection } from '#shared/forecast/project-runway.ts'
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

type ChartRow = { date: string; committed: number; weighted?: number; scenario?: number; events: ForecastEvent[] }

const rows = computed<ChartRow[]>(() =>
    props.projection.points.map((point, index) => ({
        date: point.date,
        committed: point.committed_cents / 100,
        ...(props.committedOnly ? {} : { weighted: point.weighted_cents / 100 }),
        ...(props.scenarioProjection ? { scenario: props.scenarioProjection.points[index]!.weighted_cents / 100 } : {}),
        // With a scenario, its events include the plan's plus the what-ifs.
        events: (props.scenarioProjection ?? props.projection).points[index]!.events,
    })),
)

// Tooltip lines in legend order, each with its series color.
const tooltipSeries = computed(() =>
    Object.entries(categories.value).map(([key, category]) => ({
        key: key as 'committed' | 'weighted' | 'scenario',
        name: category.name,
        color: category.color,
    })),
)

const categories = computed(() => ({
    committed: { name: 'Committed money only', color: palette.value.committed },
    ...(props.committedOnly ? {} : { weighted: { name: 'Weighted pipeline', color: palette.value.weighted } }),
    ...(props.scenarioProjection ? { scenario: { name: 'Scenario (weighted)', color: palette.value.scenario } } : {}),
}))

// The scenario line is dashed so it isn't told apart by color alone.
const lineDashArray = computed(() => Object.keys(categories.value).map(key => (key === 'scenario' ? [6, 4] : [])))

/**
 * X-axis label for a point index (month name, or "Today" for the first point).
 *
 * @param tick - Point index.
 * @returns The label.
 */
function formatMonthTick(tick: number) {
    const row = rows.value[Math.round(tick)]
    if (!row) {
        return ''
    }
    return Math.round(tick) === 0
        ? 'Today'
        : new Date(`${row.date}T00:00:00Z`).toLocaleDateString('en-US', {
              month: 'short',
              year: '2-digit',
              timeZone: 'UTC',
          })
}

/**
 * Y-axis label: compact dollars.
 *
 * @param tick - Dollar value.
 * @returns The label.
 */
function formatDollarTick(tick: number) {
    return formatMoney({ cents: tick * 100, compact: true })
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
        <LineChart
            :data="rows"
            :categories="categories"
            :height="height ?? 320"
            :x-formatter="formatMonthTick"
            :y-formatter="formatDollarTick"
            :tooltip-title-formatter="formatTooltipTitle"
            :line-dash-array="lineDashArray"
            :line-width="2"
            :curve-type="'linear' as never"
            :x-num-ticks="8"
            :y-num-ticks="5"
            :y-grid-line="true"
            :x-grid-line="false"
            :legend-position="'top-left' as never"
        >
            <template #tooltip="{ values }">
                <div v-if="values" class="max-w-80 space-y-2 p-1 text-sm">
                    <p class="font-medium text-highlighted">{{ formatTooltipTitle(values) }}</p>
                    <div v-for="series in tooltipSeries" :key="series.key" class="flex items-center gap-2">
                        <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: series.color }" />
                        <span class="flex-1 text-muted">{{ series.name }}</span>
                        <span class="font-medium text-highlighted">
                            {{ formatMoney({ cents: (values[series.key] ?? 0) * 100, compact: true }) }}
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
