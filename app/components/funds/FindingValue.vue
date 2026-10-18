<script setup lang="ts">
import { computed } from 'vue'
import type { FundFinding } from '#shared/schemas/index.ts'
import { describeFinding } from '#shared/funds/finding-display.ts'

const props = defineProps<{ finding: FundFinding; isBusy?: boolean }>()
const emit = defineEmits<{ reject: [finding: FundFinding] }>()

const display = computed(() => describeFinding({ finding: props.finding }))
</script>

<template>
    <div class="group flex items-start justify-between gap-3 py-2">
        <div class="min-w-0 space-y-1">
            <p class="text-sm text-highlighted">
                <a
                    v-if="display.href"
                    :href="display.href"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hover:underline"
                    >{{ display.title }}</a
                >
                <template v-else>{{ display.title }}</template>
                <FundsSourceChips :sources="finding.sources" class="ml-1" />
            </p>
            <p v-if="display.detail" class="text-xs text-muted">{{ display.detail }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
            <UTooltip text="AI confidence">
                <span class="text-xs tabular-nums text-dimmed">{{ Math.round(finding.confidence * 100) }}%</span>
            </UTooltip>
            <UTooltip text="Wrong? Reject it and the AI won't record it again">
                <UButton
                    icon="i-lucide-thumbs-down"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    aria-label="Reject this finding"
                    :loading="isBusy"
                    @click="emit('reject', finding)"
                />
            </UTooltip>
        </div>
    </div>
</template>
