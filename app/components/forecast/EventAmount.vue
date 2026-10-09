<script setup lang="ts">
import type { ForecastEvent } from '#shared/forecast/project-runway.ts'
import { formatMoney } from '~/utils/format.ts'

defineProps<{ event: ForecastEvent }>()

/**
 * A signed, compact amount: "+$300K" or "−$200K/mo".
 *
 * @param input.cents - Signed cents.
 * @param input.isMonthly - Per month.
 * @returns The text.
 */
function signedAmount({ cents, isMonthly }: { cents: number; isMonthly: boolean }) {
    const sign = cents > 0 ? '+' : cents < 0 ? '−' : ''
    return `${sign}${formatMoney({ cents: Math.abs(cents), compact: true })}${isMonthly ? '/mo' : ''}`
}
</script>

<template>
    <div class="text-sm whitespace-nowrap">
        <p
            v-if="event.committed_cents !== 0 || event.weighted_cents === 0"
            class="font-medium"
            :class="event.committed_cents < 0 ? 'text-error' : 'text-success'"
        >
            {{ signedAmount({ cents: event.committed_cents, isMonthly: event.is_monthly }) }}
        </p>
        <p
            v-if="event.weighted_cents !== event.committed_cents"
            class="text-xs text-muted"
            :class="event.committed_cents === 0 ? 'text-sm font-medium text-info' : ''"
        >
            {{ signedAmount({ cents: event.weighted_cents, isMonthly: event.is_monthly }) }} weighted
        </p>
    </div>
</template>
