<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useAsyncData, useSeoMeta, useToast } from '#imports'
import type { FundResearchSettings, PublicInvestmentSource, PublicInvestmentSourceList } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatRelativeTime } from '~/utils/format.ts'

useSeoMeta({ title: 'Research settings · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()

const { data: settings } = await useAsyncData('settings.research', () =>
    api<FundResearchSettings>({ path: '/fund-research/settings' }),
)
const { data: sources, refresh: refreshSources } = await useAsyncData('settings.research.sources', () =>
    api<PublicInvestmentSourceList>({ path: '/public-investment-sources' }),
)

const formState = reactive<FundResearchSettings>({
    spider_enabled: true,
    max_funds: 100,
    monthly_budget_usd: 300,
    max_searches_per_fund: 20,
    max_fetches_per_fund: 25,
    max_profiles_per_fund: 5,
    min_confidence: 0.7,
})
watch(settings, value => value && Object.assign(formState, value), { immediate: true })

const isSaving = ref(false)
const syncingKey = ref<string | null>(null)

const PUBLISHER_LABELS: Record<PublicInvestmentSource['publisher_kind'], string> = {
    dfi: 'European DFI',
    multilateral: 'Multilateral',
    us_government: 'US government',
}

/**
 * Save the research settings.
 *
 * @returns Resolves once saved.
 */
async function saveSettings() {
    isSaving.value = true
    try {
        settings.value = await api<FundResearchSettings>({
            path: '/fund-research/settings',
            method: 'PATCH',
            body: { ...formState },
        })
        toast.add({ title: 'Research settings saved', color: 'success' })
    } catch (error) {
        toast.add({ title: 'Not saved', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isSaving.value = false
    }
}

/**
 * Queue a read of one public list now.
 *
 * @param input.source - The list.
 * @returns Resolves once queued.
 */
async function syncSource({ source }: { source: PublicInvestmentSource }) {
    syncingKey.value = source.key
    try {
        await api({ path: `/public-investment-sources/${source.key}/sync`, method: 'POST' })
        toast.add({
            title: `Reading ${source.label}`,
            description: 'Refresh in a few minutes to see the count.',
            color: 'info',
        })
        await refreshSources()
    } catch (error) {
        toast.add({ title: 'Not queued', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        syncingKey.value = null
    }
}
</script>

<template>
    <div class="space-y-6">
        <UCard>
            <template #header>
                <h2 class="font-semibold text-highlighted">Research assistant</h2>
                <p class="text-sm text-muted">
                    The AI researches each fund from public sources and spiders out to new lenders until the list
                    reaches its limit.
                </p>
            </template>
            <UForm :state="formState" class="grid gap-4 sm:grid-cols-2" @submit="saveSettings">
                <UFormField
                    label="Spider"
                    description="Find and research new lenders automatically."
                    class="sm:col-span-2"
                >
                    <USwitch v-model="formState.spider_enabled" :label="formState.spider_enabled ? 'On' : 'Paused'" />
                </UFormField>
                <UFormField label="Fund limit" description="Start at 100; up to 1,000." name="max_funds">
                    <UInputNumber v-model="formState.max_funds" :min="1" :max="1000" class="w-full" />
                </UFormField>
                <UFormField
                    label="Monthly budget (USD)"
                    description="Research pauses when this month's spend reaches it."
                    name="monthly_budget_usd"
                >
                    <UInputNumber v-model="formState.monthly_budget_usd" :min="0" :step="50" class="w-full" />
                </UFormField>
                <UFormField label="Searches per fund" name="max_searches_per_fund">
                    <UInputNumber v-model="formState.max_searches_per_fund" :min="1" :max="100" class="w-full" />
                </UFormField>
                <UFormField label="Pages read per fund" name="max_fetches_per_fund">
                    <UInputNumber v-model="formState.max_fetches_per_fund" :min="1" :max="100" class="w-full" />
                </UFormField>
                <UFormField
                    label="LinkedIn profiles per fund"
                    description="Work history lookups for the team (about $0.01 each through Firecrawl). 0 turns them off."
                    name="max_profiles_per_fund"
                >
                    <UInputNumber v-model="formState.max_profiles_per_fund" :min="0" :max="20" class="w-full" />
                </UFormField>
                <UFormField
                    label="Confidence floor"
                    description="Findings the AI is less sure of are never recorded."
                    name="min_confidence"
                    class="sm:col-span-2"
                >
                    <USlider v-model="formState.min_confidence" :min="0.5" :max="1" :step="0.05" class="w-full" />
                    <p class="mt-1 text-xs text-muted">{{ Math.round(formState.min_confidence * 100) }}%</p>
                </UFormField>
                <div class="sm:col-span-2">
                    <UButton type="submit" label="Save" variant="solid" :loading="isSaving" />
                </div>
            </UForm>
        </UCard>

        <UCard>
            <template #header>
                <h2 class="font-semibold text-highlighted">Public investment lists</h2>
                <p class="text-sm text-muted">
                    DFI and government lists of investments and grants. Research cross-references them, and lenders on
                    them are added to the list. They're read weekly.
                </p>
            </template>
            <ul class="divide-y divide-default">
                <li
                    v-for="source in sources?.data ?? []"
                    :key="source.key"
                    class="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                    <div class="min-w-0">
                        <a
                            :href="source.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="font-medium hover:underline"
                            >{{ source.label }}</a
                        >
                        <p class="text-xs text-muted">
                            {{ PUBLISHER_LABELS[source.publisher_kind] }} ·
                            {{ source.feeds_spider ? '' : 'matched to funds only, adds none · '
                            }}{{ source.records }} records ·
                            {{
                                source.last_synced_at
                                    ? `read ${formatRelativeTime({ value: source.last_synced_at })}`
                                    : 'not read yet'
                            }}
                        </p>
                        <p v-if="source.last_error" class="text-xs text-error">{{ source.last_error }}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <UBadge
                            v-if="source.status === 'running'"
                            label="Reading"
                            color="info"
                            variant="soft"
                            size="sm"
                        />
                        <UBadge
                            v-else-if="source.status === 'error'"
                            label="Error"
                            color="error"
                            variant="soft"
                            size="sm"
                        />
                        <UButton
                            label="Sync now"
                            icon="i-lucide-refresh-cw"
                            size="sm"
                            color="neutral"
                            :loading="syncingKey === source.key"
                            :disabled="source.status === 'running'"
                            @click="syncSource({ source })"
                        />
                    </div>
                </li>
            </ul>
        </UCard>
    </div>
</template>
