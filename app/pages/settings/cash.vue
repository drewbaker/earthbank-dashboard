<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useAsyncData, useSeoMeta, useToast } from '#imports'
import type { GoalType } from '#shared/constants/pipeline.ts'
import { GOAL_TYPE_DETAILS, GOAL_TYPES } from '#shared/constants/pipeline.ts'
import type { CashSettings, CashSummary } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import {
    centsToDollars,
    dollarsToCents,
    formatDate,
    formatMoney,
    formatRelativeTime,
    localToday,
} from '~/utils/format.ts'

useSeoMeta({ title: 'Cash settings · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()

const { data: summary, refresh: refreshSummary } = await useAsyncData('settings.cash.summary', () =>
    api<CashSummary>({ path: '/cash/summary' }),
)
const { data: settings, refresh: refreshSettings } = await useAsyncData('settings.cash', () =>
    api<CashSettings>({ path: '/settings/cash' }),
)

const form = reactive({
    manual_balance_dollars: undefined as number | undefined,
    manual_balance_as_of: '',
    burn_override_dollars: undefined as number | undefined,
    lookback_months: 3,
    excluded_categories: [] as string[],
    include_goal_types: [] as GoalType[],
})
const isSaving = ref(false)
const isSyncing = ref(false)
const goalItems = GOAL_TYPES.map(type => ({ label: GOAL_TYPE_DETAILS[type].label, value: type }))

watch(
    settings,
    value => {
        if (!value) {
            return
        }
        Object.assign(form, {
            manual_balance_dollars: centsToDollars({ cents: value.manual_balance_cents }),
            manual_balance_as_of: value.manual_balance_as_of ?? '',
            burn_override_dollars: centsToDollars({ cents: value.burn_override_cents }),
            lookback_months: value.lookback_months,
            excluded_categories: [...value.excluded_categories],
            include_goal_types: [...value.include_goal_types],
        })
    },
    { immediate: true },
)

/**
 * Save the cash settings and reload the summary.
 *
 * @returns Resolves once saved.
 */
async function saveSettings() {
    isSaving.value = true
    try {
        const manualBalance = dollarsToCents({ dollars: form.manual_balance_dollars })
        await api({
            path: '/settings/cash',
            method: 'PUT',
            body: {
                manual_balance_cents: manualBalance,
                manual_balance_as_of: manualBalance === null ? null : form.manual_balance_as_of || localToday(),
                burn_override_cents: dollarsToCents({ dollars: form.burn_override_dollars }),
                lookback_months: form.lookback_months,
                excluded_categories: form.excluded_categories,
                include_goal_types: form.include_goal_types,
            },
        })
        toast.add({ title: 'Cash settings saved', color: 'success' })
        await Promise.all([refreshSettings(), refreshSummary()])
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isSaving.value = false
    }
}

/**
 * Queue a Bookeeping.ai sync now.
 *
 * @returns Resolves once queued.
 */
async function syncNow() {
    isSyncing.value = true
    try {
        await api({ path: '/cash/sync', method: 'POST' })
        toast.add({ title: 'Sync started', description: 'Balances update in a minute or two.', color: 'success' })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isSyncing.value = false
    }
}

/**
 * Include or exclude an account from cash on hand.
 *
 * @param input.accountId - The account.
 * @param input.isIncluded - Whether it counts.
 * @returns Resolves once saved.
 */
async function setAccountIncluded({ accountId, isIncluded }: { accountId: string; isIncluded: boolean }) {
    try {
        summary.value = await api<CashSummary>({
            path: `/cash/accounts/${accountId}`,
            method: 'PATCH',
            body: { is_included: isIncluded },
        })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    }
}
</script>

<template>
    <div class="space-y-8">
        <section class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Bookeeping.ai</h2>
                <p class="text-sm text-muted">
                    Balances and transactions sync every hour. Burn is worked out from operating spend.
                </p>
            </div>
            <UCard>
                <div v-if="summary?.sync.is_configured" class="flex flex-wrap items-center justify-between gap-3">
                    <div class="text-sm">
                        <p class="text-highlighted">
                            Connected · last synced
                            {{
                                summary.sync.last_synced_at
                                    ? formatRelativeTime({ value: summary.sync.last_synced_at })
                                    : 'never'
                            }}
                        </p>
                        <p v-if="summary.sync.last_error" class="text-error">
                            Last attempt failed: {{ summary.sync.last_error }}
                        </p>
                    </div>
                    <UButton icon="i-lucide-refresh-cw" label="Sync now" :loading="isSyncing" @click="syncNow" />
                </div>
                <UAlert
                    v-else
                    color="neutral"
                    icon="i-lucide-plug"
                    title="Not connected"
                    description="Create an API key in Bookeeping.ai (Settings → API Access) and set BOOKEEPING_API_KEY on the server. Until then, enter cash and burn by hand below."
                />

                <p v-if="summary?.accounts.length" class="mt-4 text-xs text-muted">
                    Switched-on accounts count toward cash on hand. Credit card spending always counts toward burn.
                </p>
                <ul
                    v-if="summary?.accounts.length"
                    class="mt-2 divide-y divide-default rounded-md border border-default"
                >
                    <li
                        v-for="account in summary.accounts"
                        :key="account.id"
                        class="flex items-center gap-3 px-3 py-2 text-sm"
                    >
                        <USwitch
                            :model-value="account.is_included"
                            :aria-label="`Count ${account.name} toward cash`"
                            @update:model-value="
                                isIncluded => setAccountIncluded({ accountId: account.id, isIncluded })
                            "
                        />
                        <div class="min-w-0 flex-1">
                            <p class="text-highlighted">{{ account.name }}</p>
                            <p class="text-xs text-muted">{{ account.account_type }}</p>
                        </div>
                        <div class="text-right">
                            <p class="text-highlighted">{{ formatMoney({ cents: account.balance_cents }) }}</p>
                            <p class="text-xs text-muted">{{ formatDate({ value: account.balance_as_of }) }}</p>
                        </div>
                    </li>
                </ul>
            </UCard>
        </section>

        <section v-if="summary?.burn_by_month.some(month => month.outflow_cents > 0)" class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Recent spending</h2>
                <p class="text-sm text-muted">Operating spend by month (transfers, loans and grant income left out).</p>
            </div>
            <UCard>
                <div class="grid gap-6 sm:grid-cols-2">
                    <dl class="space-y-2 text-sm">
                        <div v-for="month in summary.burn_by_month" :key="month.month" class="flex justify-between">
                            <dt class="text-muted">
                                {{ formatDate({ value: `${month.month}-01`, style: 'medium' }).replace(/ \d+,/, '') }}
                            </dt>
                            <dd class="text-highlighted">{{ formatMoney({ cents: month.outflow_cents }) }}</dd>
                        </div>
                    </dl>
                    <dl class="space-y-2 text-sm">
                        <div
                            v-for="category in summary.top_categories"
                            :key="category.name"
                            class="flex justify-between gap-4"
                        >
                            <dt class="truncate text-muted">{{ category.name }}</dt>
                            <dd class="text-highlighted">{{ formatMoney({ cents: category.monthly_cents }) }}/mo</dd>
                        </div>
                    </dl>
                </div>
            </UCard>
        </section>

        <section class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Runway inputs</h2>
                <p class="text-sm text-muted">
                    Manual figures are used when Bookeeping.ai has no data; a burn override always wins.
                </p>
            </div>
            <UCard>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField label="Cash on hand (manual)" help="Used only while no synced balance exists.">
                        <MoneyInput v-model="form.manual_balance_dollars" placeholder="Not set" />
                    </UFormField>
                    <UFormField label="As of">
                        <UInput v-model="form.manual_balance_as_of" type="date" class="w-full" />
                    </UFormField>
                    <UFormField
                        label="Monthly burn override"
                        :help="
                            summary?.computed_burn_cents !== null && summary?.computed_burn_cents !== undefined
                                ? `Computed from transactions: ${formatMoney({ cents: summary.computed_burn_cents })}/month. Leave blank to use it.`
                                : 'No transaction history yet, so set this by hand.'
                        "
                    >
                        <MoneyInput
                            v-model="form.burn_override_dollars"
                            :placeholder="
                                summary?.computed_burn_cents !== null && summary?.computed_burn_cents !== undefined
                                    ? `Calculated: ${formatMoney({ cents: summary.computed_burn_cents })}`
                                    : 'Not set'
                            "
                        />
                    </UFormField>
                    <UFormField label="Average burn over">
                        <USelect
                            v-model="form.lookback_months"
                            :items="
                                [1, 2, 3, 6, 12].map(months => ({
                                    label: `${months} month${months === 1 ? '' : 's'}`,
                                    value: months,
                                }))
                            "
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField label="Leave these categories out of burn" class="sm:col-span-2">
                        <UInputTags v-model="form.excluded_categories" placeholder="Loan repayment" class="w-full" />
                    </UFormField>
                    <UFormField
                        label="Money that extends runway"
                        help="Lending capital normally goes into the lending structure, not operations."
                        class="sm:col-span-2"
                    >
                        <UCheckboxGroup v-model="form.include_goal_types" :items="goalItems" orientation="horizontal" />
                    </UFormField>
                </div>
                <div class="mt-4 flex justify-end">
                    <UButton label="Save" variant="solid" :loading="isSaving" @click="saveSettings" />
                </div>
            </UCard>
        </section>
    </div>
</template>
