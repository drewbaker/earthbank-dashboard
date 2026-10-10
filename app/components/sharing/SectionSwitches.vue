<script setup lang="ts">
import type { ShareSections } from '#shared/schemas/index.ts'

const sections = defineModel<ShareSections>('sections', { required: true })
const showNextSteps = defineModel<boolean>('showNextSteps', { required: true })

// In page order. Next steps live in the table, so that switch only matters while the table shows.
const SECTION_SWITCHES: { key: keyof ShareSections; label: string }[] = [
    { key: 'design_grants', label: 'Design Grants tab' },
    { key: 'lending_capital', label: 'Lending Capital tab' },
    { key: 'stats', label: 'Stats box' },
    { key: 'pie', label: 'Stage pie chart' },
    { key: 'bars', label: 'Funder bar charts' },
    { key: 'table', label: 'Table' },
    { key: 'map', label: 'Coverage map' },
]
</script>

<template>
    <fieldset class="space-y-2">
        <legend class="text-sm font-medium text-highlighted">Show on this link</legend>
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <USwitch
                v-for="item in SECTION_SWITCHES"
                :key="item.key"
                :model-value="sections[item.key]"
                :label="item.label"
                @update:model-value="value => (sections = { ...sections, [item.key]: value })"
            />
            <USwitch v-model="showNextSteps" label="Next steps in the table" :disabled="!sections.table" />
        </div>
        <p v-if="!sections.design_grants && !sections.lending_capital" class="text-xs text-warning">
            Turn on at least one tab, or the page will be empty.
        </p>
    </fieldset>
</template>
