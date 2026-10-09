<script setup lang="ts">
import { computed } from 'vue'
import { OPPORTUNITY_STAGE_DETAILS, OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'
import type { Opportunity } from '#shared/schemas/index.ts'
import { useChartPalette } from '~/composables/useChartPalette.ts'
import { formatMoney } from '~/utils/format.ts'

const props = defineProps<{ opportunities: Opportunity[] }>()
const palette = useChartPalette()

const rows = computed(() =>
    OPPORTUNITY_STAGES.map(stage => {
        const atStage = props.opportunities.filter(opportunity => opportunity.stage === stage)
        return {
            stage,
            label: OPPORTUNITY_STAGE_DETAILS[stage].label,
            count: atStage.length,
            amount: atStage.reduce((sum, opportunity) => sum + (opportunity.amount_cents ?? 0), 0) / 100,
            weighted: atStage.reduce((sum, opportunity) => sum + opportunity.weighted_amount_cents, 0) / 100,
            unknownAmounts: atStage.filter(opportunity => opportunity.amount_cents === null).length,
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

/**
 * Compact dollars for the axis.
 *
 * @param tick - Dollar value.
 * @returns e.g. "$1.5M".
 */
function formatDollarTick(tick: number) {
    return formatMoney({ cents: tick * 100, compact: true })
}
</script>

<template>
    <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <UCard v-for="total in totals" :key="total.label">
                <p class="text-sm text-muted">{{ total.label }}</p>
                <p class="mt-1 text-2xl font-semibold" :class="total.color">
                    {{ formatMoney({ cents: total.amount * 100, compact: true }) }}
                </p>
                <p class="text-xs text-muted">{{ total.count }} ask{{ total.count === 1 ? '' : 's' }}</p>
            </UCard>
        </div>

        <UCard>
            <template #header>
                <h2 class="font-medium text-highlighted">How much is at each stage</h2>
                <p class="text-xs text-muted">
                    Full amounts asked; the table also shows the probability-weighted value.
                </p>
            </template>
            <ClientOnly>
                <BarChart
                    :data="rows"
                    x-axis="label"
                    :y-axis="['amount']"
                    :categories="{ amount: { name: 'Amount', color: palette.weighted } }"
                    :height="260"
                    :y-formatter="formatDollarTick"
                    :y-num-ticks="5"
                    :y-grid-line="true"
                    hide-legend
                >
                    <template #tooltip="{ values }">
                        <div
                            v-if="values"
                            class="space-y-1 rounded-md border border-default bg-elevated p-3 text-sm shadow-lg"
                        >
                            <p class="font-medium text-highlighted">{{ values.label }}</p>
                            <p>{{ formatMoney({ cents: values.amount * 100 }) }} · {{ values.count }} asks</p>
                            <p class="text-muted">{{ formatMoney({ cents: values.weighted * 100 }) }} weighted</p>
                        </div>
                    </template>
                </BarChart>
                <template #fallback><USkeleton class="h-65 w-full" /></template>
            </ClientOnly>
            <table class="mt-4 w-full text-sm">
                <thead class="text-left text-muted">
                    <tr class="border-b border-default">
                        <th class="py-2 font-medium">Stage</th>
                        <th class="py-2 text-right font-medium">Asks</th>
                        <th class="py-2 text-right font-medium">Amount</th>
                        <th class="py-2 text-right font-medium">Weighted</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row.stage" class="border-b border-default last:border-0">
                        <td class="py-2"><PipelineStageBadge :stage="row.stage" /></td>
                        <td class="py-2 text-right">{{ row.count }}</td>
                        <td class="py-2 text-right text-highlighted">
                            {{ formatMoney({ cents: row.amount * 100 }) }}
                            <span v-if="row.unknownAmounts" class="text-xs text-muted">
                                + {{ row.unknownAmounts }} unknown
                            </span>
                        </td>
                        <td class="py-2 text-right text-muted">{{ formatMoney({ cents: row.weighted * 100 }) }}</td>
                    </tr>
                </tbody>
            </table>
        </UCard>
    </div>
</template>
