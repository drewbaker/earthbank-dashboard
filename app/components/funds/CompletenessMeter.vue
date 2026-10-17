<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ value: number; label?: string }>()

// Under a third filled is a thin profile; two thirds is enough to rank on.
const color = computed(() => (props.value >= 67 ? 'success' : props.value >= 34 ? 'warning' : 'neutral'))
</script>

<template>
    <div class="flex min-w-24 items-center gap-2" :aria-label="`${label ?? 'Complete'}: ${value}%`">
        <UProgress :model-value="value" :color="color" size="sm" class="w-16" />
        <span class="text-xs tabular-nums text-muted">{{ value }}%</span>
    </div>
</template>
