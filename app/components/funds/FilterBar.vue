<script setup lang="ts">
import { computed } from 'vue'
import {
    FUND_SECTOR_LABELS,
    FUND_SECTORS,
    FUND_STAGE_DETAILS,
    FUND_STAGES,
    LOAN_TYPE_LABELS,
    LOAN_TYPES,
} from '#shared/constants/funds.ts'
import { GEO_REGIONS, GLOBAL_FOCUS } from '#shared/constants/regions.ts'
import type { FundFilters } from '~/utils/fund-filters.ts'
import { activeFundFilterCount, ANY_FILTER, EMPTY_FUND_FILTERS } from '~/utils/fund-filters.ts'

const filters = defineModel<FundFilters>({ required: true })

const anyItem = (label: string) => ({ label, value: ANY_FILTER })
const dollarItems = (label: string, amounts: [string, number][]) => [
    anyItem(label),
    ...amounts.map(([text, dollars]) => ({ label: text, value: String(dollars) })),
]

const stageItems = [
    anyItem('Any stage'),
    ...FUND_STAGES.map(stage => ({ label: FUND_STAGE_DETAILS[stage].label, value: stage })),
]
const sectorItems = [
    anyItem('Any sector'),
    ...FUND_SECTORS.map(sector => ({ label: FUND_SECTOR_LABELS[sector], value: sector })),
]
const loanTypeItems = [
    anyItem('Any loan type'),
    ...LOAN_TYPES.map(type => ({ label: LOAN_TYPE_LABELS[type], value: type })),
]
const regionItems = [
    anyItem('Anywhere'),
    { label: 'Global', value: GLOBAL_FOCUS },
    ...GEO_REGIONS.map(region => ({ label: region.label, value: region.code })),
]
const aumItems = dollarItems('Any AUM', [
    ['AUM $10M+', 10_000_000],
    ['AUM $50M+', 50_000_000],
    ['AUM $100M+', 100_000_000],
    ['AUM $500M+', 500_000_000],
    ['AUM $1B+', 1_000_000_000],
])
const fundSizeItems = dollarItems('Any fund size', [
    ['Fund $10M+', 10_000_000],
    ['Fund $25M+', 25_000_000],
    ['Fund $50M+', 50_000_000],
    ['Fund $100M+', 100_000_000],
])
const closedItems = [
    anyItem('Any last close'),
    ...[1, 2, 3, 5].map(years => ({
        label: `Closed a fund in ${years} yr${years > 1 ? 's' : ''}`,
        value: String(years),
    })),
]
const checkSizeItems = dollarItems('Any check size', [
    ['Lends $100K', 100_000],
    ['Lends $250K', 250_000],
    ['Lends $500K', 500_000],
    ['Lends $1M', 1_000_000],
    ['Lends $5M', 5_000_000],
])
const workingCapitalItems = [
    { label: 'Any lending', value: 'all' },
    { label: 'Working capital loans', value: 'any' },
    { label: 'Working capital ≥ $500K', value: 'min_500k' },
]
const completenessItems = [
    anyItem('Any completeness'),
    ...[25, 50, 75].map(percent => ({ label: `Research ${percent}%+`, value: String(percent) })),
]

const activeCount = computed(() => activeFundFilterCount({ filters: filters.value }))
</script>

<template>
    <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="filters.q" icon="i-lucide-search" placeholder="Search funds" class="w-56" />
        <USelect v-model="filters.working_capital" :items="workingCapitalItems" class="w-52" />
        <USelect v-model="filters.check_size_usd" :items="checkSizeItems" class="w-40" />
        <USelect v-model="filters.min_aum_usd" :items="aumItems" class="w-36" />
        <USelect v-model="filters.min_fund_size_usd" :items="fundSizeItems" class="w-40" />
        <USelect v-model="filters.closed_within_years" :items="closedItems" class="w-52" />
        <USelect v-model="filters.min_completeness" :items="completenessItems" class="w-44" />
        <USelect v-model="filters.stage" :items="stageItems" class="w-36" />
        <USelect v-model="filters.sector" :items="sectorItems" class="w-44" />
        <USelect v-model="filters.loan_type" :items="loanTypeItems" class="w-48" />
        <USelect v-model="filters.focus_area" :items="regionItems" class="w-48" />
        <UButton
            v-if="activeCount > 0"
            :label="`Clear ${activeCount} filter${activeCount > 1 ? 's' : ''}`"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            @click="filters = { ...EMPTY_FUND_FILTERS }"
        />
    </div>
</template>
