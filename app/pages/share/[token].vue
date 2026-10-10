<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { computed, h, ref, resolveComponent } from 'vue'
import { definePageMeta, useAsyncData, useRoute, useSeoMeta } from '#imports'
import type { SharedAsk, SharedPipeline } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'
import type { StageAsk } from '~/utils/stage-asks.ts'

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

const columns = computed<TableColumn<SharedAsk>[]>(() => [
    {
        accessorKey: 'organization',
        header: 'Organization',
        cell: ({ row }) => h('span', { class: 'font-medium text-highlighted' }, row.original.organization),
    },
    {
        accessorKey: 'contacts',
        header: 'Key contacts',
        cell: ({ row }) => row.original.contacts.join(', ') || '—',
    },
    {
        accessorKey: 'geo_focus',
        header: 'Geo focus',
        cell: ({ row }) => row.original.geo_focus.join(', ') || '—',
    },
    {
        accessorKey: 'amount_cents',
        header: () => h('div', { class: 'text-right' }, 'Grant amount'),
        cell: ({ row }) =>
            h(
                'div',
                { class: 'text-right' },
                row.original.amount_cents === null ? 'TBD' : formatMoney({ cents: row.original.amount_cents }),
            ),
    },
    {
        accessorKey: 'stage',
        header: 'Status',
        cell: ({ row }) => h(PipelineStageBadge, { stage: row.original.stage }),
    },
    ...(showsNextSteps.value
        ? [
              {
                  accessorKey: 'next_step',
                  header: 'Next steps',
                  cell: ({ row }: { row: { original: SharedAsk } }) =>
                      h('span', { class: 'block max-w-md whitespace-normal' }, row.original.next_step ?? '—'),
              },
          ]
        : []),
])
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
                <PipelineStageOverview :asks="stageAsks" />
                <UTable :data="asks" :columns="columns" class="rounded-md border border-default">
                    <template #empty>
                        <p class="py-6 text-center text-sm text-muted">Nothing to show here yet.</p>
                    </template>
                </UTable>
                <p class="text-center text-xs text-muted">Confidential. Please don't forward this link.</p>
            </template>
        </main>
    </div>
</template>
