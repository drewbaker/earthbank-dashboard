<script setup lang="ts">
import type { OpportunityStage } from '#shared/constants/pipeline.ts'
import { OPPORTUNITY_STAGE_DETAILS } from '#shared/constants/pipeline.ts'

defineProps<{ stage: OpportunityStage }>()
</script>

<template>
    <UBadge
        :color="OPPORTUNITY_STAGE_DETAILS[stage].color"
        :label="OPPORTUNITY_STAGE_DETAILS[stage].label"
        size="sm"
        variant="subtle"
    />
</template>
