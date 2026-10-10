<script setup lang="ts">
import type { GlossaryTerm } from '~/utils/glossary.ts'
import { GLOSSARY } from '~/utils/glossary.ts'

defineProps<{ term: GlossaryTerm }>()
</script>

<template>
    <UTooltip
        :text="GLOSSARY[term]"
        :content="{ side: 'top' }"
        :ui="{ content: 'max-w-72 h-auto whitespace-normal py-1.5' }"
    >
        <UIcon
            name="i-lucide-info"
            class="ml-1 inline size-3.5 shrink-0 cursor-help align-[-2px] text-muted hover:text-highlighted"
            :aria-label="GLOSSARY[term]"
            role="img"
        />
    </UTooltip>
</template>
