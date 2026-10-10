<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { computed, h, ref, resolveComponent, watch } from 'vue'
import { navigateTo, useAsyncData, useRoute, useRouter, useSeoMeta, useToast } from '#imports'
import type { GoalType, OpportunityStage } from '#shared/constants/pipeline.ts'
import { OPPORTUNITY_STAGE_DETAILS, OPPORTUNITY_STAGES, RELATIONSHIP_STATUSES } from '#shared/constants/pipeline.ts'
import type { Funder, FunderDetail, FunderList, Opportunity, OpportunityList } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { usePipelineReference } from '~/composables/usePipelineReference.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'
import { coverageAsksFromOpportunities } from '~/utils/coverage-asks.ts'
import { stageAsksFromOpportunities } from '~/utils/stage-asks.ts'
import { sortableColumns } from '~/utils/table-sorting.ts'

useSeoMeta({ title: 'Pipeline · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const { goals } = usePipelineReference()

type PipelineView = 'opportunities' | 'funders' | 'board'

// Grants (design grants and OpEx: short-term, months) and lending capital (years) are worked very
// differently, so each gets its own tab with its own goals and totals.
type PipelineTrack = 'grants' | 'lending'
const TRACK_GOAL_TYPES: Record<PipelineTrack, GoalType[]> = {
    grants: ['design_grant', 'opex'],
    lending: ['lending_capital'],
}

// The tab and view live in the URL so a view can be shared or bookmarked. Everything is shown: the
// list is short enough that filters only got in the way.
const track = ref<PipelineTrack>(route.query.track === 'lending' ? 'lending' : 'grants')
const view = ref<PipelineView>((route.query.view as PipelineView) ?? 'opportunities')

watch([track, view], () => {
    router.replace({
        query: {
            track: track.value === 'grants' ? undefined : track.value,
            view: view.value === 'opportunities' ? undefined : view.value,
        },
    })
})

const { data: opportunityList, refresh: refreshOpportunities } = await useAsyncData('pipeline.opportunities', () =>
    api<OpportunityList>({
        path: '/opportunities',
        query: { include_closed: true, limit: 500 },
    }),
)

const { data: funderList, refresh: refreshFunders } = await useAsyncData('pipeline.funders', () =>
    api<FunderList>({ path: '/funders', query: { limit: 500 } }),
)

const visibleGoalTypes = computed(() => TRACK_GOAL_TYPES[track.value])

// Funders in play for this tab's goals; prospects with no opportunity yet appear in both tabs.
const visibleFunders = computed(() =>
    (funderList.value?.data ?? []).filter(
        funder =>
            funder.goal_types.length === 0 ||
            funder.goal_types.some(goalType => visibleGoalTypes.value.includes(goalType)),
    ),
)

// Design grants are what funds OpEx, so the separate OpEx goal isn't shown.
const visibleGoals = computed(() =>
    (goals.data.value?.data ?? []).filter(
        goal => goal.type !== 'opex' && TRACK_GOAL_TYPES[track.value].includes(goal.type),
    ),
)

// This tab's asks, for the stage overview and the coverage map.
const trackOpportunities = computed(() =>
    (opportunityList.value?.data ?? []).filter(opportunity => visibleGoalTypes.value.includes(opportunity.goal_type)),
)

const trackStageAsks = computed(() => stageAsksFromOpportunities({ opportunities: trackOpportunities.value }))
const trackCoverageAsks = computed(() => coverageAsksFromOpportunities({ opportunities: trackOpportunities.value }))

// Every ask in the tab, declined ones last (the list's own order otherwise).
const visibleOpportunities = computed(() =>
    [...trackOpportunities.value].sort(
        (first, second) => Number(first.stage === 'lost') - Number(second.stage === 'lost'),
    ),
)

const viewItems = [
    { label: 'Opportunities', value: 'opportunities', icon: 'i-lucide-hand-coins' },
    { label: 'Funders', value: 'funders', icon: 'i-lucide-building-2' },
    { label: 'Board', value: 'board', icon: 'i-lucide-columns-3' },
]
const trackItems = [
    { label: 'Design Grants', value: 'grants', icon: 'i-lucide-pencil-ruler' },
    { label: 'Lending Capital', value: 'lending', icon: 'i-lucide-landmark' },
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

// Stages and relationships sort in pipeline order, not alphabetically.
const STAGE_ORDER = new Map(OPPORTUNITY_STAGES.map((stage, index) => [stage, index]))
const RELATIONSHIP_ORDER = new Map(RELATIONSHIP_STATUSES.map((status, index) => [status, index]))

const opportunityColumns: TableColumn<Opportunity>[] = sortableColumns({
    columns: [
        {
            id: 'funder',
            accessorFn: opportunity => opportunity.funder.name.toLowerCase(),
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
        {
            id: 'stage',
            accessorFn: opportunity => STAGE_ORDER.get(opportunity.stage),
            header: 'Stage',
            cell: ({ row }) => h(PipelineStageBadge, { stage: row.original.stage }),
        },
        {
            id: 'amount_cents',
            accessorFn: opportunity => opportunity.amount_cents ?? undefined,
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
            id: 'expected_receipt_at',
            accessorFn: opportunity => opportunity.expected_receipt_at ?? undefined,
            header: 'Expected',
            cell: ({ row }) => formatDate({ value: row.original.expected_receipt_at, unknown: 'Not set' }),
        },
        {
            id: 'next_step',
            accessorFn: opportunity => opportunity.next_step?.toLowerCase() ?? undefined,
            header: 'Next step',
            meta: { class: { td: 'max-w-xs truncate text-muted' } },
            cell: ({ row }) => row.original.next_step ?? '',
        },
        {
            id: 'owner',
            accessorFn: opportunity => opportunity.owner?.name ?? undefined,
            header: 'Owner',
            cell: ({ row }) => row.original.owner?.name ?? '',
        },
    ],
})

// Every opportunity on the lending tab has the same goal, so its column is left out there.
const visibleOpportunityColumns = computed(() =>
    track.value === 'lending'
        ? opportunityColumns.filter(column => (column as { accessorKey?: string }).accessorKey !== 'goal_type')
        : opportunityColumns,
)

const funderColumns: TableColumn<Funder>[] = sortableColumns({
    columns: [
        {
            id: 'name',
            accessorFn: funder => funder.name.toLowerCase(),
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
                    row.original.status === 'draft'
                        ? h(UBadge, { label: 'Draft', color: 'warning', size: 'sm' })
                        : null,
                    row.original.awaiting_reply_since
                        ? h(UBadge, { label: 'Reply needed', color: 'info', size: 'sm', icon: 'i-lucide-reply' })
                        : null,
                ]),
        },
        {
            id: 'tier',
            accessorFn: funder => funder.tier ?? undefined,
            header: 'Tier',
            cell: ({ row }) => h(PipelineTierBadge, { tier: row.original.tier }),
        },
        {
            id: 'relationship_status',
            accessorFn: funder => RELATIONSHIP_ORDER.get(funder.relationship_status),
            header: 'Relationship',
            cell: ({ row }) => h(PipelineRelationshipBadge, { status: row.original.relationship_status }),
        },
        {
            accessorKey: 'goal_types',
            header: 'Goals',
            enableSorting: false,
            cell: ({ row }) =>
                h(
                    'div',
                    { class: 'flex gap-1' },
                    row.original.goal_types.map(goalType => h(PipelineGoalBadge, { goalType })),
                ),
        },
        {
            id: 'secured',
            accessorFn: funder => funder.totals.committed_amount_cents + funder.totals.received_amount_cents,
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
            accessorFn: funder => funder.totals.open_amount_cents,
            header: 'Open asks',
            meta: { class: { th: 'text-right', td: 'text-right text-muted' } },
            cell: ({ row }) => formatMoney({ cents: row.original.totals.open_amount_cents, compact: true }),
        },
        {
            id: 'geo_focus',
            accessorFn: funder => funder.geo_focus ?? undefined,
            header: 'Geo',
            meta: { class: { td: 'text-muted' } },
            cell: ({ row }) => row.original.geo_focus ?? '',
        },
        {
            id: 'last_contact_at',
            accessorFn: funder => funder.last_contact_at ?? undefined,
            header: 'Last contact',
            cell: ({ row }) => formatDate({ value: row.original.last_contact_at, unknown: 'None logged' }),
        },
    ],
})

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
                <UTabs v-model="view" :items="viewItems" :content="false" size="sm" />
            </UDashboardToolbar>
        </template>

        <template #body>
            <div class="space-y-6">
                <!-- Opportunities: goal stats beside the stage donut, then the funder bars, then the list. -->
                <template v-if="view === 'opportunities'">
                    <div class="grid gap-6 lg:grid-cols-2">
                        <PipelineGoalSummary v-if="visibleGoals.length" :goals="visibleGoals" is-stacked />
                        <PipelineStageOverview :asks="trackStageAsks" part="pie" />
                    </div>
                    <PipelineStageOverview :asks="trackStageAsks" part="bars" />
                </template>
                <PipelineCoverageMap v-if="view === 'funders'" :asks="trackCoverageAsks" />

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
