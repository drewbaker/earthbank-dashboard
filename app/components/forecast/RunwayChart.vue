<script setup lang="ts">
import { computed } from 'vue'
import type { RunwayProjection } from '#shared/forecast/project-runway.ts'
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

type ChartRow = { date: string; committed: number; weighted?: number; scenario?: number }

const rows = computed<ChartRow[]>(() =>
    props.projection.points.map((point, index) => ({
        date: point.date,
        committed: point.committed_cents / 100,
        ...(props.committedOnly ? {} : { weighted: point.weighted_cents / 100 }),
        ...(props.scenarioProjection ? { scenario: props.scenarioProjection.points[index]!.weighted_cents / 100 } : {}),
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
        />
        <template #fallback>
            <USkeleton :style="{ height: `${height ?? 320}px` }" class="w-full" />
        </template>
    </ClientOnly>
</template>
