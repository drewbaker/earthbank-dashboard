<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h, ref, resolveComponent } from 'vue'
import type { SortingState } from '@tanstack/vue-table'
import { useToast } from '#imports'
import { FUND_ORIGIN_LABELS } from '#shared/constants/funds.ts'
import type { Fund, FundDetail } from '#shared/schemas/index.ts'
import { displayUrl } from '#shared/utils/display-url.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatDate } from '~/utils/format.ts'
import { sortableColumns } from '~/utils/table-sorting.ts'

// Funds the spider found, waiting for someone to approve them (research starts then) or archive them.
const props = defineProps<{ funds: Fund[]; isLoading: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const api = useApi()
const toast = useToast()
// Fund id → the action running on it, so only that row's button spins.
const busyFunds = ref<Record<string, 'approve' | 'archive'>>({})
const sorting = ref<SortingState>([])

const UButton = resolveComponent('UButton')
const NuxtLink = resolveComponent('NuxtLink')

const columns: TableColumn<Fund>[] = sortableColumns({
    columns: [
        {
            id: 'name',
            accessorFn: fund => fund.name.toLowerCase(),
            header: 'Fund',
            cell: ({ row }) =>
                h('div', { class: 'w-72 max-w-72 min-w-0' }, [
                    h(
                        NuxtLink,
                        {
                            to: `/funds/${row.original.id}`,
                            title: row.original.name,
                            class: 'block truncate font-medium text-highlighted hover:underline',
                        },
                        () => row.original.name,
                    ),
                    row.original.website_url
                        ? h(
                              'a',
                              {
                                  href: row.original.website_url,
                                  target: '_blank',
                                  rel: 'noopener noreferrer',
                                  class: 'block truncate text-xs text-muted hover:underline',
                              },
                              displayUrl({ url: row.original.website_url }),
                          )
                        : null,
                ]),
        },
        {
            id: 'found_how',
            accessorFn: fund => FUND_ORIGIN_LABELS[fund.origin],
            header: 'How it was found',
            cell: ({ row }) =>
                h('div', { class: 'max-w-md min-w-0 whitespace-normal' }, [
                    h('p', { class: 'text-xs text-toned' }, FUND_ORIGIN_LABELS[row.original.origin]),
                    row.original.discovery_context
                        ? h('p', { class: 'line-clamp-2 text-xs text-muted' }, row.original.discovery_context)
                        : null,
                ]),
        },
        {
            id: 'created_at',
            accessorKey: 'created_at',
            header: 'Found',
            cell: ({ row }) => formatDate({ value: row.original.created_at }),
        },
        {
            id: 'actions',
            header: '',
            enableSorting: false,
            cell: ({ row }) =>
                h('div', { class: 'flex justify-end gap-2' }, [
                    h(UButton, {
                        label: 'Archive',
                        icon: 'i-lucide-archive',
                        color: 'neutral',
                        size: 'sm',
                        loading: busyFunds.value[row.original.id] === 'archive',
                        disabled: Boolean(busyFunds.value[row.original.id]),
                        onClick: () => decideFund({ fund: row.original, action: 'archive' }),
                    }),
                    h(UButton, {
                        label: 'Approve',
                        icon: 'i-lucide-check',
                        size: 'sm',
                        loading: busyFunds.value[row.original.id] === 'approve',
                        disabled: Boolean(busyFunds.value[row.original.id]),
                        onClick: () => decideFund({ fund: row.original, action: 'approve' }),
                    }),
                ]),
        },
    ],
})

/**
 * Approve a pending fund (it joins the list and its research starts) or archive it.
 *
 * @param input.fund - The pending fund.
 * @param input.action - What to do with it.
 * @returns Resolves once saved and the lists are told to reload.
 */
async function decideFund({ fund, action }: { fund: Fund; action: 'approve' | 'archive' }) {
    busyFunds.value = { ...busyFunds.value, [fund.id]: action }
    try {
        await api<FundDetail>({ path: `/funds/${fund.id}/${action}`, method: 'POST' })
        toast.add({
            title: action === 'approve' ? `${fund.name} approved` : `${fund.name} archived`,
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
    <section class="space-y-2">
        <div>
            <h2 class="font-semibold text-highlighted">
                Pending approval <span class="font-normal text-muted">({{ props.funds.length }})</span>
                <TermHint term="fund_approval" />
            </h2>
            <p class="text-sm text-muted">
                Lenders the spider found. They aren't researched, or shown on the board or map, until someone approves
                them. Archive the ones outside Earth Bank's focus.
            </p>
        </div>
        <UTable
            v-model:sorting="sorting"
            :data="props.funds"
            :columns="columns"
            :loading="props.isLoading"
            class="rounded-md border border-default"
        >
            <template #empty>
                <UEmpty icon="i-lucide-inbox" title="Nothing waiting" description="New spider finds show up here." />
            </template>
        </UTable>
    </section>
</template>
