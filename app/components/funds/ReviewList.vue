<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { computed, h, ref, resolveComponent } from 'vue'
import type { SortingState } from '@tanstack/vue-table'
import { useToast } from '#imports'
import { FUND_ORIGIN_LABELS } from '#shared/constants/funds.ts'
import type { Fund, FundDetail } from '#shared/schemas/index.ts'
import { displayUrl } from '#shared/utils/display-url.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatDate } from '~/utils/format.ts'
import { sortableColumns } from '~/utils/table-sorting.ts'

// Funds outside the main list: `pending` ones the spider found, waiting for someone to approve them
// (research starts then) or archive them, and `archived` ones (by the team, or screened out by the
// AI), which can be restored to pending.
const props = defineProps<{ funds: Fund[]; isLoading: boolean; list: 'pending' | 'archived' }>()
const emit = defineEmits<{ changed: [] }>()

type ReviewAction = 'approve' | 'archive' | 'restore'

const api = useApi()
const toast = useToast()
// Fund id → the action running on it, so only that row's button spins.
const busyFunds = ref<Record<string, ReviewAction>>({})
const sorting = ref<SortingState>([])

const UButton = resolveComponent('UButton')
const NuxtLink = resolveComponent('NuxtLink')

const ACTION_BUTTONS: Record<ReviewAction, { label: string; icon: string; color: 'primary' | 'neutral' }> = {
    archive: { label: 'Archive', icon: 'i-lucide-archive', color: 'neutral' },
    approve: { label: 'Approve', icon: 'i-lucide-check', color: 'primary' },
    restore: { label: 'Restore', icon: 'i-lucide-archive-restore', color: 'neutral' },
}

const columns = computed<TableColumn<Fund>[]>(() =>
    sortableColumns({
        columns: [
            {
                id: 'name',
                accessorFn: fund => fund.name.toLowerCase(),
                header: 'Fund',
                cell: ({ row }) => fundCell({ fund: row.original }),
            },
            {
                id: 'found_how',
                accessorFn: fund => FUND_ORIGIN_LABELS[fund.origin],
                header: 'How it was found',
                cell: ({ row }) =>
                    h('div', { class: 'max-w-sm min-w-0 whitespace-normal' }, [
                        h('p', { class: 'text-xs text-toned' }, FUND_ORIGIN_LABELS[row.original.origin]),
                        row.original.discovery_context
                            ? h('p', { class: 'line-clamp-2 text-xs text-muted' }, row.original.discovery_context)
                            : null,
                    ]),
            },
            {
                id: 'screening',
                accessorFn: fund => (props.list === 'archived' ? archivedBy({ fund }) : fund.screening_note),
                header: props.list === 'archived' ? 'Why archived' : 'AI screen',
                meta: { term: 'fund_screening' },
                cell: ({ row }) => screeningCell({ fund: row.original }),
            },
            {
                id: 'date',
                accessorFn: fund => (props.list === 'archived' ? fund.archived_at : fund.created_at),
                header: props.list === 'archived' ? 'Archived' : 'Found',
                cell: ({ row }) =>
                    formatDate({
                        value: props.list === 'archived' ? row.original.archived_at : row.original.created_at,
                    }),
            },
            {
                id: 'actions',
                header: '',
                enableSorting: false,
                cell: ({ row }) =>
                    h(
                        'div',
                        { class: 'flex justify-end gap-2' },
                        (props.list === 'archived' ? (['restore'] as const) : (['archive', 'approve'] as const)).map(
                            action => actionButton({ fund: row.original, action }),
                        ),
                    ),
            },
        ],
    }),
)

/**
 * The fund's name (linked to its page) with its website underneath.
 *
 * @param input.fund - The fund.
 * @returns The cell's VNode.
 */
function fundCell({ fund }: { fund: Fund }) {
    return h('div', { class: 'w-64 max-w-64 min-w-0' }, [
        h(
            NuxtLink,
            {
                to: `/funds/${fund.id}`,
                title: fund.name,
                class: 'block truncate font-medium text-highlighted hover:underline',
            },
            () => fund.name,
        ),
        fund.website_url
            ? h(
                  'a',
                  {
                      href: fund.website_url,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      class: 'block truncate text-xs text-muted hover:underline',
                  },
                  displayUrl({ url: fund.website_url }),
              )
            : null,
    ])
}

/**
 * Who archived a fund, for sorting the archived list.
 *
 * @param input.fund - An archived fund.
 * @returns "ai" or "team".
 */
function archivedBy({ fund }: { fund: Fund }) {
    return fund.screened_out_at ? 'ai' : 'team'
}

/**
 * The AI screen's one-line reason, and on the archived list whether the AI or the team archived it.
 *
 * @param input.fund - The fund.
 * @returns The cell's VNode.
 */
function screeningCell({ fund }: { fund: Fund }) {
    const archivedLabel =
        props.list === 'archived' ? (fund.screened_out_at ? 'Screened out by the AI' : 'Archived by the team') : null
    if (!archivedLabel && !fund.screening_note) {
        return h('span', { class: 'text-dimmed' }, '—')
    }
    return h('div', { class: 'max-w-sm min-w-0 whitespace-normal' }, [
        archivedLabel ? h('p', { class: 'text-xs text-toned' }, archivedLabel) : null,
        fund.screening_note ? h('p', { class: 'line-clamp-2 text-xs text-muted' }, fund.screening_note) : null,
    ])
}

/**
 * One row's action button.
 *
 * @param input.fund - The fund.
 * @param input.action - What the button does.
 * @returns The button's VNode.
 */
function actionButton({ fund, action }: { fund: Fund; action: ReviewAction }) {
    return h(UButton, {
        ...ACTION_BUTTONS[action],
        size: 'sm',
        loading: busyFunds.value[fund.id] === action,
        disabled: Boolean(busyFunds.value[fund.id]),
        onClick: () => decideFund({ fund, action }),
    })
}

/**
 * Approve a pending fund (it joins the list and its research starts), archive it, or restore an
 * archived one to pending.
 *
 * @param input.fund - The fund.
 * @param input.action - What to do with it.
 * @returns Resolves once saved and the lists are told to reload.
 */
async function decideFund({ fund, action }: { fund: Fund; action: ReviewAction }) {
    busyFunds.value = { ...busyFunds.value, [fund.id]: action }
    try {
        await api<FundDetail>({ path: `/funds/${fund.id}/${action}`, method: 'POST' })
        toast.add({
            title: `${fund.name} ${{ approve: 'approved', archive: 'archived', restore: 'restored' }[action]}`,
            description: action === 'approve' ? 'Its research is queued.' : undefined,
            color: 'success',
        })
        emit('changed')
    } catch (error) {
        toast.add({ title: 'Not changed', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        const { [fund.id]: _finished, ...stillBusy } = busyFunds.value
        busyFunds.value = stillBusy
    }
}
</script>

<template>
    <UTable
        v-model:sorting="sorting"
        :data="props.funds"
        :columns="columns"
        :loading="props.isLoading"
        class="rounded-md border border-default"
    >
        <template #empty>
            <UEmpty
                :icon="props.list === 'archived' ? 'i-lucide-archive' : 'i-lucide-inbox'"
                :title="props.list === 'archived' ? 'Nothing archived' : 'Nothing waiting'"
                :description="
                    props.list === 'archived'
                        ? 'Funds you archive, and spider finds the AI screens out, show up here.'
                        : 'New spider finds show up here.'
                "
            />
        </template>
    </UTable>
</template>
