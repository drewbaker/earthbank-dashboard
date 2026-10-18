<script setup lang="ts">
import { computed } from 'vue'
import { geoFocusLabel } from '#shared/utils/geo-focus.ts'

// A fund's regional focus as tags: the first few, then "+N" with the rest on hover.
const props = withDefaults(defineProps<{ codes: string[]; max?: number }>(), { max: 3 })

const labels = computed(() => props.codes.map(code => geoFocusLabel({ code })))
const shown = computed(() => labels.value.slice(0, props.max))
const hidden = computed(() => labels.value.slice(props.max))
</script>

<template>
    <div v-if="labels.length" class="flex flex-wrap gap-1" :class="{ 'max-w-56': max <= 3 }">
        <UBadge
            v-for="label in shown"
            :key="label"
            :label="label"
            color="neutral"
            variant="soft"
            size="sm"
            class="max-w-full truncate"
        />
        <UTooltip v-if="hidden.length" :text="hidden.join(', ')">
            <UBadge :label="`+${hidden.length}`" color="neutral" variant="outline" size="sm" />
        </UTooltip>
    </div>
    <span v-else class="text-dimmed">—</span>
</template>
