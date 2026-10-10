<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { useDebounce } from '@vueuse/core'
import { computed, h, ref, resolveComponent, watch } from 'vue'
import { navigateTo, useAsyncData, useRoute, useRouter, useSeoMeta, useToast } from '#imports'
import type { FunderTier, GoalType, OpportunityStage } from '#shared/constants/pipeline.ts'
import {
    FUNDER_TIER_DETAILS,
    FUNDER_TIERS,
    OPPORTUNITY_STAGE_DETAILS,
    OPPORTUNITY_STAGES,
} from '#shared/constants/pipeline.ts'
import type { Funder, FunderDetail, FunderList, Opportunity, OpportunityList } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { usePipelineReference } from '~/composables/usePipelineReference.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'

useSeoMeta({ title: 'Pipeline · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const { goals, goalItems } = usePipelineReference()

type PipelineView = 'opportunities' | 'funders' | 'board'
const ALL = 'all'

// Grants (design grants and OpEx: short-term, months) and lending capital (years) are worked very
// differently, so each gets its own tab with its own goals, filters and totals.
type PipelineTrack = 'grants' | 'lending'
const TRACK_GOAL_TYPES: Record<PipelineTrack, GoalType[]> = {
    grants: ['design_grant', 'opex'],
    lending: ['lending_capital'],
}

// Filters live in the URL so a filtered view can be shared or bookmarked.
const track = ref<PipelineTrack>(route.query.track === 'lending' ? 'lending' : 'grants')
const view = ref<PipelineView>((route.query.view as PipelineView) ?? 'opportunities')
const goalFilter = ref<GoalType | typeof ALL>((route.query.goal as GoalType) ?? ALL)
const stageFilter = ref<OpportunityStage | typeof ALL>((route.query.stage as OpportunityStage) ?? ALL)
const tierFilter = ref<FunderTier | typeof ALL>((route.query.tier as FunderTier) ?? ALL)
const searchText = ref(typeof route.query.q === 'string' ? route.query.q : '')
const includeClosed = ref(route.query.closed === '1')
const debouncedSearch = useDebounce(searchText, 250)

watch(track, () => {
    goalFilter.value = ALL
})

watch([track, view, goalFilter, stageFilter, tierFilter, debouncedSearch, includeClosed], () => {
    router.replace({
        query: {
            track: track.value === 'grants' ? undefined : track.value,
            view: view.value === 'opportunities' ? undefined : view.value,
            goal: goalFilter.value === ALL ? undefined : goalFilter.value,
            stage: stageFilter.value === ALL ? undefined : stageFilter.value,
            tier: tierFilter.value === ALL ? undefined : tierFilter.value,
            q: debouncedSearch.value || undefined,
            closed: includeClosed.value ? '1' : undefined,
        },
    })
})

const { data: opportunityList, refresh: refreshOpportunities } = await useAsyncData('pipeline.opportunities', () =>
    api<OpportunityList>({
        path: '/opportunities',
        // Always every stage: the overview counts approved and received money; the table hides
        // closed asks itself unless "Closed" is on.
        query: { include_closed: true, limit: 500 },
    }),
)

const { data: funderList, refresh: refreshFunders } = await useAsyncData(
    'pipeline.funders',
    () =>
        api<FunderList>({
            path: '/funders',
            query: {
                tier: tierFilter.value === ALL ? undefined : tierFilter.value,
                q: debouncedSearch.value || undefined,
                limit: 500,
            },
        }),
    { watch: [tierFilter, debouncedSearch] },
)

// The goal types shown: the tab's, narrowed by the goal filter.
const visibleGoalTypes = computed(() => (goalFilter.value === ALL ? TRACK_GOAL_TYPES[track.value] : [goalFilter.value]))

// Funders in play for this tab's goals; prospects with no opportunity yet appear in both tabs.
const visibleFunders = computed(() =>
    (funderList.value?.data ?? []).filter(
        funder =>
            funder.goal_types.length === 0 ||
            funder.goal_types.some(goalType => visibleGoalTypes.value.includes(goalType)),
    ),
)

const visibleGoals = computed(() =>
    (goals.data.value?.data ?? []).filter(goal => TRACK_GOAL_TYPES[track.value].includes(goal.type)),
)

// This tab's asks (goal filter applied), for the stage overview.
const trackOpportunities = computed(() =>
    (opportunityList.value?.data ?? []).filter(opportunity => visibleGoalTypes.value.includes(opportunity.goal_type)),
)

const visibleOpportunities = computed(() => {
    const search = debouncedSearch.value.toLowerCase()
    return (opportunityList.value?.data ?? []).filter(
        opportunity =>
            visibleGoalTypes.value.includes(opportunity.goal_type) &&
            (includeClosed.value ||
                view.value === 'board' ||
                stageFilter.value !== ALL ||
                OPPORTUNITY_STAGE_DETAILS[opportunity.stage].isOpen) &&
            (stageFilter.value === ALL || opportunity.stage === stageFilter.value) &&
            (tierFilter.value === ALL || opportunity.funder.tier === tierFilter.value) &&
            (!search ||
                opportunity.funder.name.toLowerCase().includes(search) ||
                opportunity.name.toLowerCase().includes(search) ||
                (opportunity.next_step ?? '').toLowerCase().includes(search)),
    )
})

const viewItems = [
    { label: 'Opportunities', value: 'opportunities', icon: 'i-lucide-hand-coins' },
    { label: 'Funders', value: 'funders', icon: 'i-lucide-building-2' },
    { label: 'Board', value: 'board', icon: 'i-lucide-columns-3' },
]
const trackItems = [
    { label: 'Design Grants', value: 'grants', icon: 'i-lucide-pencil-ruler' },
    { label: 'Lending Capital', value: 'lending', icon: 'i-lucide-landmark' },
]
// Within the grants tab, design grants and OpEx can be told apart; lending has one goal.
const goalFilterItems = computed(() => [
    { label: 'Design grants & OpEx', value: ALL },
    ...goalItems.filter(item => TRACK_GOAL_TYPES.grants.includes(item.value)),
])
const stageFilterItems = [
    { label: 'All stages', value: ALL },
    ...OPPORTUNITY_STAGES.map(stage => ({ label: OPPORTUNITY_STAGE_DETAILS[stage].label, value: stage })),
]
const tierFilterItems = [
    { label: 'All tiers', value: ALL },
    ...FUNDER_TIERS.map(tier => ({
        label: `${FUNDER_TIER_DETAILS[tier].label} · ${FUNDER_TIER_DETAILS[tier].description}`,
        value: tier,
    })),
]

const isFunderModalOpen = ref(false)
const isOpportunityModalOpen = ref(false)
const editingOpportunity = ref<Opportunity | null>(null)

const UBadge = resolveComponent('UBadge')
const NuxtLink = resolveComponent('NuxtLink')
const PipelineGoalBadge = resolveComponent('PipelineGoalBadge')
const PipelineStageBadge = resolveComponent('PipelineStageBadge')
const PipelineTierBadge = resolveComponent('PipelineTierBadge')
const PipelineRelationshipBadge = resolveComponent('PipelineRelationshipBadge')

const opportunityColumns: TableColumn<Opportunity>[] = [
    {
        accessorKey: 'funder',
        header: 'Funder',
        cell: ({ row }) =>
            h('div', { class: 'flex items-center gap-2' }, [
                h(PipelineTierBadge, { tier: row.original.funder.tier }),
                // The ask's name under the funder's, so a funder with several grants reads clearly.
                h('div', { class: 'min-w-0' }, [
                    h(
                        NuxtLink,
                        {
                            to: `/pipeline/funders/${row.original.funder.id}`,
                            class: 'font-medium text-highlighted hover:underline',
                        },
                        () => row.original.funder.name,
                    ),
                    h('p', { class: 'truncate text-xs text-muted' }, row.original.name),
                ]),
            ]),
    },
    {
        accessorKey: 'goal_type',
        header: 'Goal',
        cell: ({ row }) => h(PipelineGoalBadge, { goalType: row.original.goal_type }),
    },
    { accessorKey: 'stage', header: 'Stage', cell: ({ row }) => h(PipelineStageBadge, { stage: row.original.stage }) },
    {
        accessorKey: 'amount_cents',
        header: 'Amount',
        meta: { class: { th: 'text-right', td: 'text-right' } },
        cell: ({ row }) => formatMoney({ cents: row.original.amount_cents, compact: true }),
    },
    {
        accessorKey: 'weighted_amount_cents',
        header: 'Weighted',
        meta: { class: { th: 'text-right', td: 'text-right text-muted' } },
        cell: ({ row }) =>
            `${formatMoney({ cents: row.original.weighted_amount_cents, compact: true })} · ${row.original.probability}%`,
    },
    {
        accessorKey: 'expected_receipt_at',
        header: 'Expected',
        cell: ({ row }) => formatDate({ value: row.original.expected_receipt_at, unknown: 'Not set' }),
    },
    {
        accessorKey: 'next_step',
        header: 'Next step',
        meta: { class: { td: 'max-w-xs truncate text-muted' } },
        cell: ({ row }) => row.original.next_step ?? '',
    },
    { accessorKey: 'owner', header: 'Owner', cell: ({ row }) => row.original.owner?.name ?? '' },
]

// Every opportunity on the lending tab has the same goal, so its column is left out there.
const visibleOpportunityColumns = computed(() =>
    track.value === 'lending'
        ? opportunityColumns.filter(column => (column as { accessorKey?: string }).accessorKey !== 'goal_type')
        : opportunityColumns,
)

const funderColumns: TableColumn<Funder>[] = [
    {
        accessorKey: 'name',
        header: 'Funder',
        cell: ({ row }) =>
            h('div', { class: 'flex items-center gap-2' }, [
                h(
                    NuxtLink,
                    {
                        to: `/pipeline/funders/${row.original.id}`,
                        class: 'font-medium text-highlighted hover:underline',
                    },
                    () => row.original.name,
                ),
                row.original.status === 'draft' ? h(UBadge, { label: 'Draft', color: 'warning', size: 'sm' }) : null,
                row.original.awaiting_reply_since
                    ? h(UBadge, { label: 'Reply needed', color: 'info', size: 'sm', icon: 'i-lucide-reply' })
                    : null,
            ]),
    },
    { accessorKey: 'tier', header: 'Tier', cell: ({ row }) => h(PipelineTierBadge, { tier: row.original.tier }) },
    {
        accessorKey: 'relationship_status',
        header: 'Relationship',
        cell: ({ row }) => h(PipelineRelationshipBadge, { status: row.original.relationship_status }),
    },
    {
        accessorKey: 'goal_types',
        header: 'Goals',
        cell: ({ row }) =>
            h(
                'div',
                { class: 'flex gap-1' },
                row.original.goal_types.map(goalType => h(PipelineGoalBadge, { goalType })),
            ),
    },
    {
        id: 'secured',
        header: 'Secured',
        meta: { class: { th: 'text-right', td: 'text-right' } },
        cell: ({ row }) =>
            formatMoney({
                cents: row.original.totals.committed_amount_cents + row.original.totals.received_amount_cents,
                compact: true,
            }),
    },
    {
        id: 'open',
        header: 'Open asks',
        meta: { class: { th: 'text-right', td: 'text-right text-muted' } },
        cell: ({ row }) => formatMoney({ cents: row.original.totals.open_amount_cents, compact: true }),
    },
    { accessorKey: 'geo_focus', header: 'Geo', meta: { class: { td: 'text-muted' } } },
    {
        accessorKey: 'last_contact_at',
        header: 'Last contact',
        cell: ({ row }) => formatDate({ value: row.original.last_contact_at, unknown: 'None logged' }),
    },
]

/**
 * Open the edit form for an opportunity.
 *
 * @param opportunity - The opportunity (board card or table row).
 * @returns Nothing.
 */
function editOpportunity(opportunity: Opportunity) {
    editingOpportunity.value = opportunity
    isOpportunityModalOpen.value = true
}

/**
 * Move an opportunity to another stage from the board.
 *
 * @param input.opportunity - The dragged opportunity.
 * @param input.stage - Its new stage.
 * @returns Resolves once saved and reloaded.
 */
async function moveOpportunity({ opportunity, stage }: { opportunity: Opportunity; stage: OpportunityStage }) {
    try {
        await api({ path: `/opportunities/${opportunity.id}`, method: 'PATCH', body: { stage } })
        toast.add({
            title: `${opportunity.funder.name} moved to ${OPPORTUNITY_STAGE_DETAILS[stage].label}`,
            color: 'success',
        })
        await reloadPipeline()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    }
}

/**
 * Reload every list on the page after a change.
 *
 * @returns Resolves once all lists are fresh.
 */
async function reloadPipeline() {
    await Promise.all([refreshOpportunities(), refreshFunders(), goals.refresh()])
}

/**
 * After creating a funder, open its page.
 *
 * @param funder - The new funder.
 * @returns Resolves after navigation.
 */
async function openCreatedFunder(funder: FunderDetail) {
    await navigateTo(`/pipeline/funders/${funder.id}`)
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Pipeline">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
                <template #right>
                    <UButton
                        icon="i-lucide-plus"
                        label="New funder"
                        variant="solid"
                        @click="isFunderModalOpen = true"
                    />
                </template>
            </UDashboardNavbar>
            <UDashboardToolbar>
                <UTabs v-model="track" :items="trackItems" :content="false" variant="link" class="-mb-px" />
            </UDashboardToolbar>
            <UDashboardToolbar>
                <template #left>
                    <UTabs v-model="view" :items="viewItems" :content="false" size="sm" />
                </template>
                <template #right>
                    <UInput v-model="searchText" icon="i-lucide-search" placeholder="Search" class="w-44" />
                    <USelect v-if="track === 'grants'" v-model="goalFilter" :items="goalFilterItems" class="w-48" />
                    <USelect
                        v-if="view === 'opportunities'"
                        v-model="stageFilter"
                        :items="stageFilterItems"
                        class="w-40"
                    />
                    <USelect v-model="tierFilter" :items="tierFilterItems" class="w-36" />
                    <USwitch v-if="view === 'opportunities'" v-model="includeClosed" label="Closed" />
                </template>
            </UDashboardToolbar>
        </template>

        <template #body>
            <div class="space-y-6">
                <PipelineStageOverview v-if="view === 'opportunities'" :opportunities="trackOpportunities" />
                <PipelineGoalSummary v-if="visibleGoals.length" :goals="visibleGoals" />

                <UTable
                    v-if="view === 'opportunities'"
                    :data="visibleOpportunities"
                    :columns="visibleOpportunityColumns"
                    class="rounded-md border border-default"
                    :ui="{ tr: 'cursor-pointer' }"
                    @select="(_event: Event, row: { original: Opportunity }) => editOpportunity(row.original)"
                >
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-hand-coins"
                            title="No opportunities match"
                            description="Try another goal, stage or search."
                        />
                    </template>
                </UTable>

                <UTable
                    v-else-if="view === 'funders'"
                    :data="visibleFunders"
                    :columns="funderColumns"
                    class="rounded-md border border-default"
                >
                    <template #empty>
                        <UEmpty
                            icon="i-lucide-building-2"
                            title="No funders match"
                            description="Try another filter, or add a funder."
                        />
                    </template>
                </UTable>

                <PipelineStageBoard
                    v-else
                    :opportunities="visibleOpportunities"
                    @move="moveOpportunity"
                    @select="editOpportunity"
                />
            </div>

            <PipelineFunderModal v-model:open="isFunderModalOpen" @saved="openCreatedFunder" />
            <PipelineOpportunityModal
                v-model:open="isOpportunityModalOpen"
                :opportunity="editingOpportunity"
                @saved="reloadPipeline"
            />
        </template>
    </UDashboardPanel>
</template>
