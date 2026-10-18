<script setup lang="ts">
import { FUND_SOURCE_KIND_LABELS } from '#shared/constants/funds.ts'
import type { FundSourceLink } from '#shared/schemas/index.ts'

defineProps<{ sources: FundSourceLink[] }>()
</script>

<template>
    <div class="flex flex-wrap gap-1">
        <UTooltip
            v-for="source in sources"
            :key="source.id"
            :content="{ side: 'top' }"
            :ui="{ content: 'max-w-[min(360px,85vw)] h-auto whitespace-normal py-2' }"
        >
            <UButton
                :to="source.url"
                target="_blank"
                rel="noopener noreferrer"
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-external-link"
                :label="source.domain"
                class="max-w-48"
                :ui="{ label: 'truncate' }"
            />
            <template #content>
                <div class="space-y-1 text-xs">
                    <p class="font-medium text-highlighted">{{ source.title ?? source.domain }}</p>
                    <p class="text-muted">{{ FUND_SOURCE_KIND_LABELS[source.kind] }}</p>
                    <p v-if="source.quote" class="italic">“{{ source.quote }}”</p>
                </div>
            </template>
        </UTooltip>
    </div>
</template>
