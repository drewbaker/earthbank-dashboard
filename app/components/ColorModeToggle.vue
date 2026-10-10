<script setup lang="ts">
import { computed } from 'vue'
import { useColorMode } from '#imports'

const colorMode = useColorMode()

const MODES = [
    { value: 'light', label: 'Light', icon: 'i-lucide-sun' },
    { value: 'dark', label: 'Dark', icon: 'i-lucide-moon' },
    { value: 'system', label: 'Auto (match your device)', icon: 'i-lucide-monitor' },
] as const

const preference = computed({
    get: () => colorMode.preference,
    set: value => {
        colorMode.preference = value
    },
})
</script>

<template>
    <!-- ClientOnly: the saved preference lives in the browser, so the server can't know which is active. -->
    <ClientOnly>
        <div
            class="flex items-center gap-0.5 rounded-md border border-default p-0.5"
            role="radiogroup"
            aria-label="Theme"
        >
            <UTooltip v-for="mode in MODES" :key="mode.value" :text="mode.label">
                <UButton
                    :icon="mode.icon"
                    size="xs"
                    :color="preference === mode.value ? 'primary' : 'neutral'"
                    :variant="preference === mode.value ? 'soft' : 'ghost'"
                    role="radio"
                    :aria-checked="preference === mode.value"
                    :aria-label="mode.label"
                    @click="preference = mode.value"
                />
            </UTooltip>
        </div>
        <template #fallback><div class="h-7 w-22" /></template>
    </ClientOnly>
</template>
