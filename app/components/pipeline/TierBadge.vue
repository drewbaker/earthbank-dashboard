<script setup lang="ts">
import type { FunderTier } from '#shared/constants/pipeline.ts'
import { FUNDER_TIER_DETAILS } from '#shared/constants/pipeline.ts'

defineProps<{ tier: FunderTier | null }>()
</script>

<template>
    <UTooltip v-if="tier" :text="FUNDER_TIER_DETAILS[tier].description">
        <UBadge
            :color="FUNDER_TIER_DETAILS[tier].color"
            :label="FUNDER_TIER_DETAILS[tier].label"
            size="sm"
            variant="outline"
        />
    </UTooltip>
    <span v-else class="text-dimmed">—</span>
</template>
