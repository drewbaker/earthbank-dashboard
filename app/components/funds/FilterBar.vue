<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import {
    FUND_SECTOR_LABELS,
    FUND_SECTORS,
    FUND_STAGE_DETAILS,
    FUND_STAGES,
    LENDER_ARCHETYPE_LABELS,
    LENDER_ARCHETYPES,
    LENDING_CHANNEL_LABELS,
    LENDING_CHANNELS,
    LOAN_TYPE_LABELS,
    LOAN_TYPES,
    TICKET_FIT_DETAILS,
    TICKET_FITS,
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

const fitSignalItems = [
    anyItem('Any fit signals'),
    ...[2, 3, 4, 5, 6].map(count => ({ label: `${count}+ fit signals`, value: String(count) })),
]

const ticketFitItems = [
    anyItem('Any ticket fit'),
    ...TICKET_FITS.map(fit => ({ label: TICKET_FIT_DETAILS[fit].label, value: fit })),
]
const archetypeItems = [
    anyItem('Any lender type'),
    ...LENDER_ARCHETYPES.map(archetype => ({ label: LENDER_ARCHETYPE_LABELS[archetype], value: archetype })),
]
const channelItems = [
    anyItem('Direct or on-lending'),
    ...LENDING_CHANNELS.map(channel => ({ label: LENDING_CHANNEL_LABELS[channel], value: channel })),
]
const currencyItems = [anyItem('Any currency'), { label: 'Lends in local currency', value: 'yes' }]

type SelectFilterKey = Exclude<keyof FundFilters, 'q'>

// Every select filter, in the order shown when they're all open.
const selectFilters: { key: SelectFilterKey; items: { label: string; value: string }[]; widthClass: string }[] = [
    { key: 'min_fit_signals', items: fitSignalItems, widthClass: 'w-44' },
    { key: 'working_capital', items: workingCapitalItems, widthClass: 'w-52' },
    { key: 'ticket_fit', items: ticketFitItems, widthClass: 'w-44' },
    { key: 'check_size_usd', items: checkSizeItems, widthClass: 'w-40' },
    { key: 'min_aum_usd', items: aumItems, widthClass: 'w-36' },
    { key: 'min_fund_size_usd', items: fundSizeItems, widthClass: 'w-40' },
    { key: 'closed_within_years', items: closedItems, widthClass: 'w-52' },
    { key: 'min_completeness', items: completenessItems, widthClass: 'w-44' },
    { key: 'stage', items: stageItems, widthClass: 'w-36' },
    { key: 'sector', items: sectorItems, widthClass: 'w-44' },
    { key: 'loan_type', items: loanTypeItems, widthClass: 'w-48' },
    { key: 'focus_area', items: regionItems, widthClass: 'w-48' },
    { key: 'lender_archetype', items: archetypeItems, widthClass: 'w-56' },
    { key: 'lending_channel', items: channelItems, widthClass: 'w-52' },
    { key: 'local_currency', items: currencyItems, widthClass: 'w-52' },
]

// The filters someone used last stay in view (newest first), even after they're cleared.
const RECENT_FILTER_LIMIT = 4
const recentFilterKeys = useLocalStorage<SelectFilterKey[]>('earthbank_dashboard_fund_filters_recent', [], {
    initOnMounted: true,
})
const isShowingAllFilters = ref(false)

watch(
    () => ({ ...filters.value }),
    (current, previous) => {
        const changedKeys = selectFilters
            .map(filter => filter.key)
            .filter(key => current[key] !== previous[key] && current[key] !== EMPTY_FUND_FILTERS[key])
        if (changedKeys.length) {
            recentFilterKeys.value = [
                ...changedKeys,
                ...recentFilterKeys.value.filter(key => !changedKeys.includes(key)),
            ].slice(0, RECENT_FILTER_LIMIT)
        }
    },
)

const visibleFilters = computed(() =>
    selectFilters.filter(
        filter =>
            isShowingAllFilters.value ||
            filters.value[filter.key] !== EMPTY_FUND_FILTERS[filter.key] ||
            recentFilterKeys.value.includes(filter.key),
    ),
)
const hiddenFilterCount = computed(() => selectFilters.length - visibleFilters.value.length)
const activeCount = computed(() => activeFundFilterCount({ filters: filters.value }))
</script>

<template>
    <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="filters.q" icon="i-lucide-search" placeholder="Search funds" class="w-56" />
        <USelect
            v-for="filter in visibleFilters"
            :key="filter.key"
            v-model="filters[filter.key]"
            :items="filter.items"
            :class="filter.widthClass"
        />
        <UTooltip :text="isShowingAllFilters ? 'Show fewer filters' : `Show ${hiddenFilterCount} more filters`">
            <UButton
                :icon="isShowingAllFilters ? 'i-lucide-chevron-left' : 'i-lucide-ellipsis'"
                :aria-label="isShowingAllFilters ? 'Show fewer filters' : 'Show more filters'"
                :aria-expanded="isShowingAllFilters"
                color="neutral"
                variant="ghost"
                @click="isShowingAllFilters = !isShowingAllFilters"
            />
        </UTooltip>
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
