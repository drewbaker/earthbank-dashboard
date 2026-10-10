<script setup lang="ts">
import type { GlossaryTerm } from '~/utils/glossary.ts'
import { GLOSSARY } from '~/utils/glossary.ts'

defineProps<{ term: GlossaryTerm }>()
</script>

<template>
    <UTooltip
        :text="GLOSSARY[term]"
        :content="{ side: 'top' }"
        :delay-duration="100"
        :ui="{ content: 'max-w-72 h-auto whitespace-normal py-1.5' }"
    >
        <!-- A 24px target around the 14px icon, pulled in with negative margins so it doesn't shift text. -->
        <span
            class="-my-1 ml-0.5 inline-flex size-6 cursor-help items-center justify-center rounded-full align-middle text-muted hover:bg-elevated hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
            tabindex="0"
            role="img"
            :aria-label="GLOSSARY[term]"
        >
            <UIcon name="i-lucide-info" class="size-3.5" />
        </span>
    </UTooltip>
</template>
