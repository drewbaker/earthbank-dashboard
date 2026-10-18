<script setup lang="ts">
import { FUND_SOURCE_KIND_LABELS } from '#shared/constants/funds.ts'
import type { FundSourceLink } from '#shared/schemas/index.ts'

defineProps<{ sources: FundSourceLink[] }>()
</script>

<template>
    <!-- One small ⓘ per source, inline after the fact: hover says where it was found, click opens it. -->
    <span v-if="sources.length" class="inline-flex items-center gap-0.5 align-middle">
        <UTooltip
            v-for="source in sources"
            :key="source.id"
            :content="{ side: 'top' }"
            :ui="{ content: 'max-w-[min(360px,85vw)] h-auto whitespace-normal py-2' }"
        >
            <a
                :href="source.url"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`Source: ${source.title ?? source.domain}`"
                class="inline-flex size-4 items-center justify-center rounded-full text-dimmed hover:text-primary"
            >
                <UIcon name="i-lucide-info" class="size-3.5" />
            </a>
            <template #content>
                <div class="space-y-1 text-xs">
                    <p class="font-medium text-highlighted">{{ source.title ?? source.domain }}</p>
                    <p class="text-muted">{{ FUND_SOURCE_KIND_LABELS[source.kind] }} · {{ source.domain }}</p>
                    <p v-if="source.quote" class="italic">“{{ source.quote }}”</p>
                </div>
            </template>
        </UTooltip>
    </span>
</template>
