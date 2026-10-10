<script setup lang="ts">
import { CurveType } from 'nuxt-charts/enums'
import { computed } from 'vue'
import type { Opportunity } from '#shared/schemas/index.ts'
import { useChartPalette } from '~/composables/useChartPalette.ts'
import { formatMoney, localToday } from '~/utils/format.ts'

// Lending capital moves on a years-long timeline, so it gets its own chart rather than sharing the
// operating runway's 24 months: money raised to date plus what's expected to land, quarter by quarter.

const props = defineProps<{ opportunities: Opportunity[]; height?: number }>()
const palette = useChartPalette()

const MIN_YEARS = 5

type QuarterRow = { label: string; committed: number; weighted: number }

const lending = computed(() => props.opportunities.filter(opportunity => opportunity.goal_type === 'lending_capital'))

const timeline = computed(() => {
    const today = localToday()
    const received = lending.value.filter(opportunity => opportunity.stage === 'received')
    const dated = lending.value.filter(
        opportunity =>
            opportunity.expected_receipt_at && opportunity.stage !== 'lost' && opportunity.stage !== 'received',
    )
    const raised = received.reduce((sum, opportunity) => sum + (opportunity.amount_cents ?? 0), 0) / 100
    const lastDate = [today, ...dated.map(opportunity => opportunity.expected_receipt_at!)].sort().at(-1)!
    const startYear = Number(today.slice(0, 4))
    const startQuarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3)
    const quarters = Math.max(MIN_YEARS * 4, (Number(lastDate.slice(0, 4)) - startYear) * 4 + 4)

    const rows: QuarterRow[] = []
    let committed = raised
    let weighted = raised
    for (let index = 0; index <= quarters; index++) {
        const quarter = (startQuarter + index) % 4
        const year = startYear + Math.floor((startQuarter + index) / 4)
        const quarterEnd = `${year}-${String(quarter * 3 + 3).padStart(2, '0')}-31`
        for (const opportunity of dated) {
            const date = opportunity.expected_receipt_at! < today ? today : opportunity.expected_receipt_at!
            const isInQuarter =
                index === 0 ? date <= quarterEnd : date <= quarterEnd && date > previousQuarterEnd({ year, quarter })
            if (!isInQuarter) {
                continue
            }
            const amount = (opportunity.amount_cents ?? 0) / 100
            if (opportunity.stage === 'committed') {
                committed += amount
            }
            weighted += opportunity.weighted_amount_cents / 100
        }
        rows.push({ label: index === 0 ? 'Now' : `Q${quarter + 1} ’${String(year).slice(2)}`, committed, weighted })
    }
    const undated = lending.value.filter(
        opportunity =>
            !opportunity.expected_receipt_at && opportunity.stage !== 'lost' && opportunity.stage !== 'received',
    )
    return { rows, raised, undated }
})

/**
 * The last day of the quarter before, as YYYY-MM-DD.
 *
 * @param input.year - The year.
 * @param input.quarter - 0–3.
 * @returns The date.
 */
function previousQuarterEnd({ year, quarter }: { year: number; quarter: number }) {
    return quarter === 0 ? `${year - 1}-12-31` : `${year}-${String(quarter * 3).padStart(2, '0')}-31`
}

/**
 * Compact dollars for the axis.
 *
 * @param tick - Dollar value.
 * @returns e.g. "$25M".
 */
function formatDollarTick(tick: number) {
    return formatMoney({ cents: tick * 100, compact: true })
}
</script>

<template>
    <div>
        <ClientOnly>
            <LineChart
                :data="timeline.rows"
                x-axis="label"
                :categories="{
                    weighted: { name: 'Weighted pipeline', color: palette.weighted },
                    committed: { name: 'Approved and received', color: palette.committed },
                }"
                :height="height ?? 300"
                :y-formatter="formatDollarTick"
                :curve-type="CurveType.StepAfter"
                :line-width="2"
                :y-num-ticks="5"
                :y-grid-line="true"
            />
            <template #fallback><USkeleton :style="{ height: `${height ?? 300}px` }" class="w-full" /></template>
        </ClientOnly>
        <p class="mt-3 text-sm text-muted">
            {{ formatMoney({ cents: timeline.raised * 100, compact: true }) }} received so far.
            <template v-if="timeline.undated.length">
                {{ timeline.undated.length }} lending ask{{ timeline.undated.length === 1 ? ' has' : 's have' }} no
                expected date and {{ timeline.undated.length === 1 ? "isn't" : "aren't" }} on the chart:
                {{ timeline.undated.map(opportunity => opportunity.funder.name).join(', ') }}.
            </template>
        </p>
    </div>
</template>
