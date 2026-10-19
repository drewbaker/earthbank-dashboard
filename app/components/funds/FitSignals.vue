<script setup lang="ts">
import { computed } from 'vue'
import type { FundFitSignal, FundFitSignalStatus } from '#shared/constants/funds.ts'
import { FUND_FIT_SIGNAL_LABELS, FUND_FIT_SIGNALS } from '#shared/constants/funds.ts'

// How a fund measures up to the team's criteria for a lender worth researching: a "4/6" badge that
// lists the signals on hover, or the full checklist (`list`) on the fund page.
const props = defineProps<{ signals: Record<FundFitSignal, FundFitSignalStatus>; list?: boolean }>()

const STATUS_DETAILS: Record<FundFitSignalStatus, { icon: string; class: string; statusLabel: string }> = {
    met: { icon: 'i-lucide-circle-check', class: 'text-success', statusLabel: 'Yes' },
    not_met: { icon: 'i-lucide-circle-x', class: 'text-error', statusLabel: 'No' },
    unknown: { icon: 'i-lucide-circle-help', class: 'text-muted', statusLabel: 'Not found yet' },
}

const rows = computed(() =>
    FUND_FIT_SIGNALS.map(signal => ({
        signal,
        label: FUND_FIT_SIGNAL_LABELS[signal],
        ...STATUS_DETAILS[props.signals[signal]],
    })),
)
const metCount = computed(() => FUND_FIT_SIGNALS.filter(signal => props.signals[signal] === 'met').length)
const badgeColor = computed(() => (metCount.value >= 4 ? 'success' : metCount.value >= 2 ? 'warning' : 'neutral'))
</script>

<template>
    <ul v-if="props.list" class="space-y-1 text-sm">
        <li v-for="row in rows" :key="row.signal" class="flex items-center gap-2">
            <UIcon :name="row.icon" :class="['size-4 shrink-0', row.class]" :aria-label="row.statusLabel" />
            <span :class="props.signals[row.signal] === 'unknown' ? 'text-muted' : 'text-default'">{{
                row.label
            }}</span>
        </li>
    </ul>
    <UTooltip v-else :ui="{ content: 'h-auto' }">
        <UBadge
            :label="`${metCount}/${FUND_FIT_SIGNALS.length}`"
            :color="badgeColor"
            :variant="metCount >= 4 ? 'solid' : 'soft'"
            size="sm"
        />
        <template #content>
            <ul class="space-y-1 py-1 text-xs">
                <li v-for="row in rows" :key="row.signal" class="flex items-center gap-1.5">
                    <UIcon :name="row.icon" :class="['size-3.5 shrink-0', row.class]" />
                    {{ row.label }}
                </li>
            </ul>
        </template>
    </UTooltip>
</template>
