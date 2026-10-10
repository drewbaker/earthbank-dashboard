<script setup lang="ts">
import { computed } from 'vue'
import { OPPORTUNITY_STAGE_DETAILS, OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'
import type { Opportunity } from '#shared/schemas/index.ts'
import { formatMoney } from '~/utils/format.ts'

const props = defineProps<{ opportunities: Opportunity[] }>()

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
</script>

<template>
    <div>
        <div class="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <UCard v-for="total in totals" :key="total.label">
                <p class="text-sm text-muted">{{ total.label }}</p>
                <p class="mt-1 text-2xl font-semibold" :class="total.color">
                    {{ formatMoney({ cents: total.amount, compact: true }) }}
                </p>
                <p class="text-xs text-muted">{{ total.count }} ask{{ total.count === 1 ? '' : 's' }}</p>
            </UCard>
        </div>
    </div>
</template>
