<script setup lang="ts">
import { computed } from 'vue'
import { RECENT_ACTIVITY_MONTHS } from '#shared/constants/funds.ts'
import type { Fund } from '#shared/schemas/index.ts'
import { formatDate, localToday } from '~/utils/format.ts'

// A fund's newest activity (research, an email with the fund, or the team's confirmation), flagged
// "Possibly closed" when there's been none for a year.
const props = defineProps<{ lastActivityOn: string | null; source: Fund['last_activity_source'] }>()

const SOURCE_LABELS: Record<NonNullable<Fund['last_activity_source']>, string> = {
    research: 'Found by research',
    email: "Latest email with the fund's domain",
    team: 'Confirmed active by the team',
}

const isStale = computed(() => {
    if (!props.lastActivityOn) {
        return false
    }
    const today = localToday()
    const cutoff = `${Number(today.slice(0, 4)) - RECENT_ACTIVITY_MONTHS / 12}${today.slice(4)}`
    return props.lastActivityOn < cutoff
})
</script>

<template>
    <span v-if="!props.lastActivityOn" class="text-dimmed">—</span>
    <span v-else class="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span :title="props.source ? SOURCE_LABELS[props.source] : undefined">
            {{ formatDate({ value: props.lastActivityOn }) }}
        </span>
        <UTooltip
            v-if="isStale"
            text="No activity found in the last 12 months (research, email or the team); the fund may have closed."
        >
            <UBadge label="Possibly closed" color="warning" variant="soft" size="sm" />
        </UTooltip>
    </span>
</template>
