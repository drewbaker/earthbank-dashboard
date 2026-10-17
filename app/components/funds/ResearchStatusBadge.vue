<script setup lang="ts">
import type { FundResearchStatus } from '#shared/constants/funds.ts'
import { FUND_RESEARCH_STATUS_DETAILS } from '#shared/constants/funds.ts'

defineProps<{ status: FundResearchStatus; error?: string | null }>()
</script>

<template>
    <UTooltip :text="error ?? undefined" :disabled="!error">
        <UBadge
            :color="FUND_RESEARCH_STATUS_DETAILS[status].color"
            :label="FUND_RESEARCH_STATUS_DETAILS[status].label"
            :icon="status === 'running' ? 'i-lucide-loader-circle' : undefined"
            :ui="{ leadingIcon: 'animate-spin' }"
            size="sm"
            variant="soft"
        />
    </UTooltip>
</template>
