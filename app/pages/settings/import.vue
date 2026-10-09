<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSeoMeta } from '#imports'
import { GOAL_TYPE_DETAILS, OPPORTUNITY_STAGE_DETAILS } from '#shared/constants/pipeline.ts'
import type { PipelineImportPreview, PipelineImportResult } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatMoney } from '~/utils/format.ts'

useSeoMeta({ title: 'Import · Earth Bank Dashboard' })

const api = useApi()
const file = ref<File | null>(null)
const preview = ref<PipelineImportPreview | null>(null)
const result = ref<PipelineImportResult | null>(null)
const isWorking = ref(false)
const errorMessage = ref<string | null>(null)

const previewTotals = computed(() => {
    const funders = preview.value?.funders ?? []
    return {
        funders: funders.length,
        contacts: funders.reduce((sum, funder) => sum + funder.contact_count, 0),
        opportunities: funders.reduce((sum, funder) => sum + funder.opportunities.length, 0),
    }
})

/**
 * Send the chosen spreadsheet, either to preview it or to import it.
 *
 * @param input.isDryRun - Preview only; nothing is written.
 * @returns Resolves once the preview or result is shown.
 */
async function sendSpreadsheet({ isDryRun }: { isDryRun: boolean }) {
    if (!file.value) {
        return
    }
    isWorking.value = true
    errorMessage.value = null
    const form = new FormData()
    form.append('file', file.value)
    try {
        const response = await api<PipelineImportPreview | PipelineImportResult>({
            path: '/imports/pipeline',
            method: 'POST',
            query: { dry_run: isDryRun },
            body: form,
        })
        if (isDryRun) {
            preview.value = response as PipelineImportPreview
            result.value = null
        } else {
            result.value = response as PipelineImportResult
            preview.value = null
        }
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error, fallback: 'Could not read the spreadsheet.' })
    } finally {
        isWorking.value = false
    }
}

/**
 * Start over with a different file.
 *
 * @param value - The chosen file (UFileUpload's model value).
 * @returns Nothing.
 */
function chooseFile(value: File | null | undefined) {
    file.value = value ?? null
    preview.value = null
    result.value = null
    errorMessage.value = null
}
</script>

<template>
    <div class="space-y-6">
        <div>
            <h2 class="text-lg font-semibold text-highlighted">Import the fundraising spreadsheet</h2>
            <p class="text-sm text-muted">
                Upload the Google Sheet as .xlsx (File → Download → Microsoft Excel). Only the "Master Pipeline" tab is
                read. Importing again is safe: funders are matched by name, nothing is deleted, and anything edited in
                the dashboard (by hand or by the AI) is kept.
            </p>
        </div>

        <UCard>
            <div class="space-y-4">
                <UFileUpload
                    :model-value="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    label="Drop the .xlsx here"
                    description="Earth Bank - Fundraising, Fund Manager, and Contacts.xlsx"
                    class="w-full"
                    @update:model-value="chooseFile"
                />
                <div class="flex flex-wrap justify-end gap-2">
                    <UButton
                        label="Preview"
                        icon="i-lucide-eye"
                        :disabled="!file"
                        :loading="isWorking && !preview"
                        @click="sendSpreadsheet({ isDryRun: true })"
                    />
                    <UButton
                        label="Import"
                        icon="i-lucide-upload"
                        variant="solid"
                        :disabled="!preview"
                        :loading="isWorking && Boolean(preview)"
                        @click="sendSpreadsheet({ isDryRun: false })"
                    />
                </div>
                <UAlert v-if="errorMessage" color="error" icon="i-lucide-circle-alert" :title="errorMessage" />
            </div>
        </UCard>

        <UAlert
            v-if="result"
            color="success"
            icon="i-lucide-circle-check"
            title="Imported"
            :description="`Funders: ${result.funders_created} new, ${result.funders_updated} updated, ${result.funders_unchanged} unchanged. Contacts added: ${result.contacts_added}. Opportunities: ${result.opportunities_created} new, ${result.opportunities_updated} updated.`"
            :actions="[{ label: 'Open the pipeline', to: '/pipeline' }]"
        />

        <UCard v-if="preview" :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
                <p class="font-medium text-highlighted">
                    {{ previewTotals.funders }} funders, {{ previewTotals.contacts }} contacts,
                    {{ previewTotals.opportunities }} opportunities found
                </p>
                <p class="text-xs text-muted">Nothing has been written yet. Check it looks right, then Import.</p>
            </template>
            <ul v-if="preview.warnings.length" class="space-y-1 border-b border-default px-4 py-3 text-xs text-muted">
                <li v-for="warning in preview.warnings" :key="warning">{{ warning }}</li>
            </ul>
            <ul class="max-h-96 divide-y divide-default overflow-y-auto">
                <li
                    v-for="funder in preview.funders"
                    :key="funder.name"
                    class="flex flex-wrap items-center gap-2 px-4 py-2 text-sm"
                >
                    <span class="min-w-0 flex-1 truncate text-highlighted">{{ funder.name }}</span>
                    <span class="text-xs text-muted">{{ funder.contact_count }} contacts</span>
                    <UBadge
                        v-for="opportunity in funder.opportunities"
                        :key="opportunity.goal_type"
                        :color="GOAL_TYPE_DETAILS[opportunity.goal_type].color"
                        size="sm"
                        :label="`${GOAL_TYPE_DETAILS[opportunity.goal_type].label} · ${OPPORTUNITY_STAGE_DETAILS[opportunity.stage].label}${opportunity.amount_cents ? ` · ${formatMoney({ cents: opportunity.amount_cents, compact: true })}` : ''}`"
                    />
                </li>
            </ul>
        </UCard>
    </div>
</template>
