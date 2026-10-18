<script setup lang="ts">
import type { FundStage } from '#shared/constants/funds.ts'
import { FUND_STAGE_DETAILS } from '#shared/constants/funds.ts'

defineProps<{ stage: FundStage }>()
</script>

<template>
    <UBadge
        :color="FUND_STAGE_DETAILS[stage].color"
        :label="FUND_STAGE_DETAILS[stage].label"
        size="sm"
        variant="subtle"
    />
</template>
