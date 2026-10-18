<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { computed, h, ref, resolveComponent, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { navigateTo, useAsyncData, useRoute, useRouter, useSeoMeta, useToast } from '#imports'
import type { FundStage } from '#shared/constants/funds.ts'
import {
    FUND_STAGES,
    LENDER_ARCHETYPE_LABELS,
    LOAN_TYPE_LABELS,
    TICKET_FITS,
    TICKET_FIT_DETAILS,
    WORKING_CAPITAL_TARGET_CENTS,
} from '#shared/constants/funds.ts'
import type { Fund, FundDetail, FundList, FundResearchSettings, FundResearchStatus } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { countryName } from '~/utils/fund-findings.ts'
import type { FundFilters } from '~/utils/fund-filters.ts'
import { fundFiltersFromQuery, fundFiltersToApiQuery, fundFiltersToQuery } from '~/utils/fund-filters.ts'
import { formatDate, formatMoney, localToday } from '~/utils/format.ts'
import { sortableColumns } from '~/utils/table-sorting.ts'

useSeoMeta({ title: 'Funds · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()
const route = useRoute()
const router = useRouter()

type FundsView = 'table' | 'board' | 'map'
const view = ref<FundsView>(route.query.view === 'board' || route.query.view === 'map' ? route.query.view : 'table')
const filters = ref<FundFilters>(fundFiltersFromQuery({ query: route.query }))
// Typing in search shouldn't refetch on every keystroke.
const debouncedFilters = ref<FundFilters>({ ...filters.value })
watchDebounced(filters, value => (debouncedFilters.value = { ...value }), { debounce: 300, deep: true })

watch(
    [view, filters],
    () => {
        router.replace({
            query: {
                ...fundFiltersToQuery({ filters: filters.value }),
                view: view.value === 'table' ? undefined : view.value,
            },
        })
    },
    { deep: true },
)

const apiQuery = computed(() => fundFiltersToApiQuery({ filters: debouncedFilters.value, today: localToday() }))

const {
    data: fundList,
    refresh: refreshFunds,
    status: listStatus,
} = await useAsyncData('funds.list', () => api<FundList>({ path: '/funds', query: apiQuery.value }), {
    watch: [apiQuery],
})
const { data: researchStatus, refresh: refreshStatus } = await useAsyncData('funds.research-status', () =>
    api<FundResearchStatus>({ path: '/fund-research/status' }),
)

const funds = computed(() => fundList.value?.data ?? [])
const isCreateOpen = ref(false)
const isTogglingSpider = ref(false)

const viewItems = [
    { label: 'Table', value: 'table', icon: 'i-lucide-table' },
    { label: 'Board', value: 'board', icon: 'i-lucide-columns-3' },
    { label: 'Map', value: 'map', icon: 'i-lucide-map' },
]

const UBadge = resolveComponent('UBadge')
const NuxtLink = resolveComponent('NuxtLink')
const FundsStageBadge = resolveComponent('FundsStageBadge')
const FundsCompletenessMeter = resolveComponent('FundsCompletenessMeter')
const FundsResearchStatusBadge = resolveComponent('FundsResearchStatusBadge')

const STAGE_ORDER = new Map(FUND_STAGES.map((stage, index) => [stage, index]))
// Best fit first when sorting descending.
const TICKET_FIT_ORDER = new Map(TICKET_FITS.map((fit, index) => [fit, TICKET_FITS.length - index]))

const columns: TableColumn<Fund>[] = sortableColumns({
    columns: [
        {
            id: 'name',
            accessorFn: fund => fund.name.toLowerCase(),
            header: 'Fund',
            cell: ({ row }) =>
                h('div', { class: 'min-w-0 max-w-72' }, [
                    h('div', { class: 'flex items-center gap-2' }, [
                        h(
                            NuxtLink,
                            { to: `/funds/${row.original.id}`, class: 'font-medium text-highlighted hover:underline' },
                            () => row.original.name,
                        ),
                        // The research found several same-named sites; a person picks on the fund page.
                        row.original.identity_candidates.length
                            ? h(UBadge, {
                                  label: row.original.website_url ? 'Confirm LinkedIn' : 'Needs website',
                                  color: 'warning',
                                  size: 'sm',
                              })
                            : null,
                    ]),
                    row.original.summary
                        ? h('p', { class: 'truncate text-xs text-muted' }, row.original.summary)
                        : null,
                ]),
        },
        {
            id: 'headquarters',
            accessorFn: fund => countryName({ code: fund.hq_country }) || undefined,
            header: 'HQ',
            cell: ({ row }) => h('span', { class: 'text-sm' }, countryName({ code: row.original.hq_country }) || '—'),
        },
        {
            id: 'aum',
            accessorFn: fund => fund.aum_cents ?? undefined,
            header: 'AUM',
            cell: ({ row }) => formatMoney({ cents: row.original.aum_cents, compact: true }),
        },
        {
            id: 'latest_fund',
            accessorFn: fund => fund.latest_fund_size_cents ?? undefined,
            header: 'Latest fund',
            cell: ({ row }) => formatMoney({ cents: row.original.latest_fund_size_cents, compact: true }),
        },
        {
            id: 'last_close',
            accessorFn: fund => fund.last_fund_close_on ?? undefined,
            header: 'Last close',
            cell: ({ row }) => formatDate({ value: row.original.last_fund_close_on, unknown: '—' }),
        },
        {
            id: 'check_size',
            accessorFn: fund => fund.check_max_cents ?? fund.check_min_cents ?? undefined,
            header: 'Check size',
            cell: ({ row }) => checkSizeLabel({ fund: row.original }),
        },
        {
            id: 'working_capital',
            accessorFn: fund =>
                fund.has_working_capital_loans ? (fund.max_working_capital_loan_cents ?? 1) : undefined,
            header: 'Working capital',
            meta: { term: 'working_capital_loans' },
            cell: ({ row }) => workingCapitalCell({ fund: row.original }),
        },
        {
            id: 'ticket_fit',
            accessorFn: fund => (fund.ticket_fit ? TICKET_FIT_ORDER.get(fund.ticket_fit) : undefined),
            header: 'Our ticket',
            meta: { term: 'ticket_fit' },
            cell: ({ row }) =>
                row.original.ticket_fit
                    ? h(UBadge, {
                          color: TICKET_FIT_DETAILS[row.original.ticket_fit].color,
                          variant: row.original.ticket_fit === 'fits' ? 'solid' : 'soft',
                          size: 'sm',
                          label: TICKET_FIT_DETAILS[row.original.ticket_fit].label,
                      })
                    : h('span', { class: 'text-dimmed' }, '—'),
        },
        {
            id: 'lender_archetype',
            accessorFn: fund => (fund.lender_archetype ? LENDER_ARCHETYPE_LABELS[fund.lender_archetype] : undefined),
            header: 'Lender type',
            cell: ({ row }) =>
                h(
                    'span',
                    { class: 'line-clamp-2 max-w-40 text-xs text-toned' },
                    row.original.lender_archetype ? LENDER_ARCHETYPE_LABELS[row.original.lender_archetype] : '—',
                ),
        },
        {
            id: 'loan_types',
            accessorFn: fund => fund.loan_types.length || undefined,
            header: 'Loan types',
            cell: ({ row }) =>
                h(
                    'span',
                    { class: 'line-clamp-2 max-w-48 text-xs text-toned' },
                    row.original.loan_types.map(type => LOAN_TYPE_LABELS[type]).join(', ') || '—',
                ),
        },
        {
            id: 'research_completeness',
            accessorKey: 'research_completeness',
            header: 'Research',
            meta: { term: 'research_completeness' },
            cell: ({ row }) =>
                h('div', { class: 'space-y-1' }, [
                    h(FundsCompletenessMeter, { value: row.original.research_completeness, label: 'Research' }),
                    row.original.research_status === 'done'
                        ? null
                        : h(FundsResearchStatusBadge, { status: row.original.research_status }),
                ]),
        },
        {
            id: 'diligence_completeness',
            accessorKey: 'diligence_completeness',
            header: 'Diligence',
            meta: { term: 'diligence_completeness' },
            cell: ({ row }) =>
                h(FundsCompletenessMeter, { value: row.original.diligence_completeness, label: 'Diligence' }),
        },
        {
            id: 'stage',
            accessorFn: fund => STAGE_ORDER.get(fund.stage),
            header: 'Stage',
            cell: ({ row }) => h(FundsStageBadge, { stage: row.original.stage }),
        },
    ],
})

/**
 * The check-size range as text.
 *
 * @param input.fund - The fund.
 * @returns "$500K–$5M", or a dash when unknown.
 */
function checkSizeLabel({ fund }: { fund: Fund }) {
    if (fund.check_min_cents === null && fund.check_max_cents === null) {
        return '—'
    }
    return [fund.check_min_cents, fund.check_max_cents]
        .map(cents => formatMoney({ cents, compact: true, unknown: '?' }))
        .join('–')
}

/**
 * The working-capital cell: whether they make working-capital loans, highlighted at $500K or more.
 *
 * @param input.fund - The fund.
 * @returns The cell's VNode.
 */
function workingCapitalCell({ fund }: { fund: Fund }) {
    if (!fund.has_working_capital_loans) {
        return h('span', { class: 'text-dimmed' }, '—')
    }
    const largest = fund.max_working_capital_loan_cents
    const isTarget = largest !== null && largest >= WORKING_CAPITAL_TARGET_CENTS
    return h(UBadge, {
        color: isTarget ? 'success' : 'neutral',
        variant: isTarget ? 'solid' : 'soft',
        size: 'sm',
        label: largest === null ? 'Yes' : `Up to ${formatMoney({ cents: largest, compact: true })}`,
    })
}

/**
 * Move a fund to another stage (board drag).
 *
 * @param input.fund - The fund dragged.
 * @param input.stage - Where it was dropped.
 * @returns Resolves once saved and reloaded.
 */
async function moveFund({ fund, stage }: { fund: Fund; stage: FundStage }) {
    try {
        await api<FundDetail>({ path: `/funds/${fund.id}`, method: 'PATCH', body: { stage } })
        await refreshFunds()
    } catch (error) {
        toast.add({ title: 'Stage not changed', description: apiErrorMessage({ error }), color: 'error' })
    }
}

/**
 * Pause or resume the spider (finding and researching new lenders).
 *
 * @returns Resolves once saved.
 */
async function toggleSpider() {
    isTogglingSpider.value = true
    try {
        await api<FundResearchSettings>({
            path: '/fund-research/settings',
            method: 'PATCH',
            body: { spider_enabled: !researchStatus.value?.spider_enabled },
        })
        await refreshStatus()
    } catch (error) {
        toast.add({ title: 'Not changed', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isTogglingSpider.value = false
    }
}

/**
 * Open a newly added fund.
 *
 * @param fund - The fund.
 * @returns Resolves after navigation.
 */
async function openCreatedFund(fund: FundDetail) {
    await navigateTo(`/funds/${fund.id}`)
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Funds">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
                <template #right>
                    <UButton
                        v-if="researchStatus"
                        :icon="researchStatus.spider_enabled ? 'i-lucide-pause' : 'i-lucide-play'"
                        :label="researchStatus.spider_enabled ? 'Pause spider' : 'Resume spider'"
                        color="neutral"
                        :loading="isTogglingSpider"
                        @click="toggleSpider"
                    />
                    <UButton icon="i-lucide-plus" label="Add fund" variant="solid" @click="isCreateOpen = true" />
                </template>
            </UDashboardNavbar>
            <UDashboardToolbar>
                <UTabs v-model="view" :items="viewItems" :content="false" size="sm" />
            </UDashboardToolbar>
        </template>

        <template #body>
            <div class="space-y-4">
                <UAlert
                    v-if="researchStatus && !researchStatus.is_ai_configured"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-key-round"
                    title="Research is waiting for an Anthropic API key"
                    description="Funds stay queued until ANTHROPIC_API_KEY is set."
                />
                <div v-if="researchStatus" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <UCard :ui="{ body: 'p-4 sm:p-4' }">
                        <p class="text-xs text-muted">Funds <TermHint term="fund_spider" /></p>
                        <p class="text-2xl font-semibold text-highlighted">
                            {{ researchStatus.funds
                            }}<span class="text-base font-normal text-muted"> / {{ researchStatus.max_funds }}</span>
                        </p>
                        <p class="text-xs text-muted">Spider {{ researchStatus.spider_enabled ? 'on' : 'paused' }}</p>
                    </UCard>
                    <UCard :ui="{ body: 'p-4 sm:p-4' }">
                        <p class="text-xs text-muted">Researched</p>
                        <p class="text-2xl font-semibold text-highlighted">{{ researchStatus.done }}</p>
                        <p class="text-xs text-muted">
                            {{ researchStatus.failed }} failed · {{ researchStatus.skipped }} paused
                        </p>
                    </UCard>
                    <UCard :ui="{ body: 'p-4 sm:p-4' }">
                        <p class="text-xs text-muted">In the queue</p>
                        <p class="text-2xl font-semibold text-highlighted">
                            {{ researchStatus.queued + researchStatus.running }}
                        </p>
                        <p class="text-xs text-muted">{{ researchStatus.running }} researching now</p>
                    </UCard>
                    <UCard :ui="{ body: 'p-4 sm:p-4' }">
                        <p class="text-xs text-muted">Spent this month</p>
                        <p class="text-2xl font-semibold text-highlighted">
                            ${{ researchStatus.month_spend_usd.toFixed(2)
                            }}<span class="text-base font-normal text-muted">
                                / ${{ researchStatus.monthly_budget_usd }}</span
                            >
                        </p>
                        <UProgress
                            :model-value="
                                Math.min(
                                    100,
                                    (researchStatus.month_spend_usd / Math.max(researchStatus.monthly_budget_usd, 1)) *
                                        100,
                                )
                            "
                            size="xs"
                            class="mt-1"
                        />
                    </UCard>
                </div>

                <FundsFilterBar v-model="filters" />

                <UTable
                    v-if="view === 'table'"
                    :data="funds"
                    :columns="columns"
                    :loading="listStatus === 'pending'"
                    class="rounded-md border border-default"
                >
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-landmark"
                            title="No funds match"
                            description="Try fewer filters, or add a fund."
                        />
                    </template>
                </UTable>
                <FundsBoard v-else-if="view === 'board'" :funds="funds" @move="moveFund" />
                <FundsCoverageMap v-else :funds="funds" />
            </div>

            <FundsCreateModal v-model:open="isCreateOpen" @saved="openCreatedFund" />
        </template>
    </UDashboardPanel>
</template>
