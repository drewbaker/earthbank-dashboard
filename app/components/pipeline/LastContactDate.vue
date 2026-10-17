<script setup lang="ts">
import { computed } from 'vue'
import type { ContactStaleness } from '#shared/utils/contact-staleness.ts'
import { contactStaleness, daysSinceContact } from '#shared/utils/contact-staleness.ts'
import { formatDate, localToday } from '~/utils/format.ts'

const props = defineProps<{
    /** Last contact date (`YYYY-MM-DD`), or null when none is logged. */
    value: string | null
    /** Flag it yellow or red when it's been a while; off for asks that are already closed. */
    isTracked?: boolean
    /** Show "None logged" instead of the default dash when there's no date. */
    unknown?: string
}>()

const staleness = computed<ContactStaleness>(() =>
    contactStaleness({ lastContactAt: props.value, today: localToday() }),
)

const STALENESS_CLASSES: Record<ContactStaleness, string> = {
    recent: 'text-default',
    stale: 'text-warning font-medium',
    overdue: 'text-error font-medium',
    never: 'text-muted',
}

const toneClass = computed(() => (props.isTracked ? STALENESS_CLASSES[staleness.value] : 'text-muted'))

const tooltip = computed(() => {
    if (!props.value) return 'No contact logged yet'
    const days = daysSinceContact({ lastContactAt: props.value, today: localToday() })
    const ago = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
    return `Last contact ${ago}`
})
</script>

<template>
    <UTooltip :text="tooltip" :delay-duration="100">
        <span class="inline-flex items-center gap-1 whitespace-nowrap" :class="toneClass">
            <UIcon
                v-if="isTracked && (staleness === 'stale' || staleness === 'overdue')"
                name="i-lucide-clock-alert"
                class="size-3.5 shrink-0"
            />
            {{ formatDate({ value, unknown: unknown ?? 'None logged' }) }}
        </span>
    </UTooltip>
</template>
