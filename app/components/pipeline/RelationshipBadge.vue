<script setup lang="ts">
import type { RelationshipStatus } from '#shared/constants/pipeline.ts'
import { RELATIONSHIP_STATUS_DETAILS } from '#shared/constants/pipeline.ts'

defineProps<{ status: RelationshipStatus }>()
</script>

<template>
    <UBadge
        :color="RELATIONSHIP_STATUS_DETAILS[status].color"
        :label="RELATIONSHIP_STATUS_DETAILS[status].label"
        size="sm"
        variant="subtle"
    />
</template>
