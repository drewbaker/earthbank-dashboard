<script setup lang="ts">
import type { GoalType } from '#shared/constants/pipeline.ts'
import { GOAL_TYPE_DETAILS } from '#shared/constants/pipeline.ts'

defineProps<{ goalType: GoalType }>()
</script>

<template>
    <UBadge :color="GOAL_TYPE_DETAILS[goalType].color" :label="GOAL_TYPE_DETAILS[goalType].label" size="sm" />
</template>
