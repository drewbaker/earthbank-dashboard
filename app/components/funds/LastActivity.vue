<script setup lang="ts">
import { computed } from 'vue'
import { RECENT_ACTIVITY_MONTHS } from '#shared/constants/funds.ts'
import { formatDate, localToday } from '~/utils/format.ts'

// A fund's newest dated public activity, flagged "Possibly closed" when there's been none for a year.
const props = defineProps<{ lastActivityOn: string | null }>()

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
        {{ formatDate({ value: props.lastActivityOn }) }}
        <UTooltip v-if="isStale" text="No public activity found in the last 12 months; the fund may have closed.">
            <UBadge label="Possibly closed" color="warning" variant="soft" size="sm" />
        </UTooltip>
    </span>
</template>
