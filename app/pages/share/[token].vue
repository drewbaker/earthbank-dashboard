<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { computed, h, ref, resolveComponent } from 'vue'
import { definePageMeta, useAsyncData, useRoute, useSeoMeta } from '#imports'
import { OPPORTUNITY_STAGES } from '#shared/constants/pipeline.ts'
import type { SharedAsk, SharedPipeline } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'
import type { StageAsk } from '~/utils/stage-asks.ts'
import { sortableColumns } from '~/utils/table-sorting.ts'

// Funders open this without an account: the secret link plus a password. Nothing here links back
// into the dashboard.
definePageMeta({ layout: false, public: true })
useSeoMeta({ title: 'Funding pipeline · Earth Bank', robots: 'noindex, nofollow' })

const api = useApi()
const route = useRoute()
const token = computed(() => String(route.params.token ?? ''))

type PageState = { kind: 'ready'; pipeline: SharedPipeline } | { kind: 'locked' } | { kind: 'missing' }

const { data: page, refresh } = await useAsyncData<PageState>(`share.${token.value}`, async () => {
    try {
        return { kind: 'ready', pipeline: await api<SharedPipeline>({ path: `/shared/${token.value}` }) }
    } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode
        return status === 401 ? { kind: 'locked' } : { kind: 'missing' }
    }
})

const password = ref('')
const unlockError = ref<string | null>(null)
const isUnlocking = ref(false)

/**
 * Send the password; on success the server remembers it for this browser and the page loads.
 *
 * @returns Resolves once unlocked or the error is shown.
 */
async function unlock() {
    unlockError.value = null
    isUnlocking.value = true
    try {
        await api({ path: `/shared/${token.value}/unlock`, method: 'POST', body: { password: password.value } })
        password.value = ''
        await refresh()
    } catch (error) {
        unlockError.value = apiErrorMessage({ error })
    } finally {
        isUnlocking.value = false
    }
}

type ShareTrack = 'design_grants' | 'lending_capital'
const track = ref<ShareTrack>('design_grants')
const trackItems = [
    { label: 'Design Grants', value: 'design_grants', icon: 'i-lucide-pencil-ruler' },
    { label: 'Lending Capital', value: 'lending_capital', icon: 'i-lucide-landmark' },
]

const asks = computed<SharedAsk[]>(() => (page.value?.kind === 'ready' ? page.value.pipeline[track.value] : []))
const goals = computed(() =>
    page.value?.kind === 'ready'
        ? page.value.pipeline[track.value === 'design_grants' ? 'design_grant_goals' : 'lending_capital_goals']
        : [],
)
const stageAsks = computed<StageAsk[]>(() =>
    asks.value.map((ask, index) => ({
        key: `${track.value}-${index}`,
        label: ask.organization,
        organization: ask.organization,
        stage: ask.stage,
        amount_cents: ask.amount_cents,
    })),
)
const showsNextSteps = computed(() => asks.value.some(ask => ask.next_step !== null))

const PipelineStageBadge = resolveComponent('PipelineStageBadge')

const STAGE_ORDER = new Map(OPPORTUNITY_STAGES.map((stage, index) => [stage, index]))

// Fixed widths with wrapping, so long contact lists and next steps don't push the table sideways.
const wrapping = (width: string) => ({ class: { th: width, td: `${width} whitespace-normal align-top` } })

const columns = computed<TableColumn<SharedAsk>[]>(() =>
    sortableColumns({
        columns: [
            {
                id: 'organization',
                accessorFn: ask => ask.organization.toLowerCase(),
                header: 'Organization',
                meta: wrapping('w-48 min-w-40'),
                cell: ({ row }) => h('span', { class: 'font-medium text-highlighted' }, row.original.organization),
            },
            {
                id: 'contacts',
                accessorFn: ask => ask.contacts.join(', ').toLowerCase() || undefined,
                header: 'Key contacts',
                meta: wrapping('w-56 min-w-44 max-w-64'),
                cell: ({ row }) => row.original.contacts.join(', ') || '—',
            },
            {
                id: 'geo_focus',
                accessorFn: ask => ask.geo_focus.join(', ') || undefined,
                header: 'Geo focus',
                meta: wrapping('w-36 min-w-28'),
                cell: ({ row }) => row.original.geo_focus.join(', ') || '—',
            },
            {
                id: 'amount_cents',
                accessorFn: ask => ask.amount_cents ?? undefined,
                header: 'Grant amount',
                meta: { class: { th: 'w-32 text-right', td: 'w-32 text-right align-top' } },
                cell: ({ row }) =>
                    row.original.amount_cents === null ? 'TBD' : formatMoney({ cents: row.original.amount_cents }),
            },
            {
                id: 'stage',
                accessorFn: ask => STAGE_ORDER.get(ask.stage),
                header: 'Status',
                meta: { class: { th: 'w-36', td: 'w-36 align-top' } },
                cell: ({ row }) => h(PipelineStageBadge, { stage: row.original.stage }),
            },
            ...(showsNextSteps.value
                ? [
                      {
                          id: 'next_step',
                          accessorFn: (ask: SharedAsk) => ask.next_step?.toLowerCase() ?? undefined,
                          header: 'Next steps',
                          meta: wrapping('min-w-64 max-w-md'),
                          cell: ({ row }: { row: { original: SharedAsk } }) => row.original.next_step ?? '—',
                      } satisfies TableColumn<SharedAsk>,
                  ]
                : []),
        ],
    }),
)
</script>

<template>
    <div class="min-h-svh bg-default">
        <header class="border-b border-default">
            <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
                <div>
                    <p class="font-semibold text-highlighted">Earth Bank</p>
                    <p class="text-sm text-muted">
                        Funding pipeline
                        <template v-if="page?.kind === 'ready'">
                            · updated {{ formatDate({ value: page.pipeline.updated_at }) }}
                        </template>
                    </p>
                </div>
                <ColorModeToggle />
            </div>
        </header>

        <main class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
            <UCard v-if="page?.kind === 'locked'" class="mx-auto mt-12 max-w-sm">
                <form class="space-y-4" @submit.prevent="unlock">
                    <div>
                        <h1 class="text-lg font-semibold text-highlighted">Enter the password</h1>
                        <p class="text-sm text-muted">Earth Bank sent it to you with this link.</p>
                    </div>
                    <UFormField :error="unlockError ?? undefined">
                        <UInput
                            v-model="password"
                            type="password"
                            autocomplete="current-password"
                            placeholder="Password"
                            class="w-full"
                            autofocus
                        />
                    </UFormField>
                    <UButton type="submit" block label="View pipeline" :loading="isUnlocking" />
                </form>
            </UCard>

            <UCard v-else-if="page?.kind === 'missing'" class="mx-auto mt-12 max-w-sm text-center">
                <h1 class="text-lg font-semibold text-highlighted">This link doesn't work</h1>
                <p class="mt-1 text-sm text-muted">
                    It may have been turned off. Ask your Earth Bank contact for a new one.
                </p>
            </UCard>

            <template v-else-if="page?.kind === 'ready'">
                <UTabs v-model="track" :items="trackItems" :content="false" variant="link" />
                <!-- Same layout as Pipeline: goal stats beside the stage donut, funder bars, then the list. -->
                <div class="grid gap-6 lg:grid-cols-2">
                    <PipelineGoalSummary v-if="goals.length" :goals="goals" is-stacked />
                    <PipelineStageOverview :asks="stageAsks" part="pie" />
                </div>
                <PipelineStageOverview :asks="stageAsks" part="bars" />
                <UTable
                    :data="asks"
                    :columns="columns"
                    class="rounded-md border border-default"
                    :ui="{ base: 'table-fixed' }"
                >
                    <template #empty>
                        <p class="py-6 text-center text-sm text-muted">Nothing to show here yet.</p>
                    </template>
                </UTable>
                <p class="text-center text-xs text-muted">Confidential. Please don't forward this link.</p>
            </template>
        </main>
    </div>
</template>
