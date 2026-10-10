<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAsyncData, useSeoMeta, useToast } from '#imports'
import type { ChangeSource, ChangeStatus } from '#shared/constants/pipeline.ts'
import { CHANGE_SOURCE_LABELS, CHANGE_SOURCES } from '#shared/constants/pipeline.ts'
import type { ActivitySummary, ChangeEventList, FunderList } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { useChangeEventActions } from '~/composables/useChangeEventActions.ts'

useSeoMeta({ title: 'Activity · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()
const ALL = 'all'

const sourceFilter = ref<ChangeSource | typeof ALL>(ALL)
const statusFilter = ref<ChangeStatus | typeof ALL>(ALL)
const extraPages = ref<ChangeEventList['data']>([])
const nextCursor = ref<string | null>(null)
const isLoadingMore = ref(false)
const busyFunderId = ref<string | null>(null)

const { data: summary, refresh: refreshSummary } = await useAsyncData('activity.summary', () =>
    api<ActivitySummary>({ path: '/activity/summary' }),
)
const { data: pending, refresh: refreshPending } = await useAsyncData('activity.pending', () =>
    api<ChangeEventList>({ path: '/change-events', query: { status: 'pending', limit: 100 } }),
)
const { data: drafts, refresh: refreshDrafts } = await useAsyncData('activity.drafts', () =>
    api<FunderList>({ path: '/funders', query: { status: 'draft' } }),
)
const { data: feed, refresh: refreshFeed } = await useAsyncData(
    'activity.feed',
    async () => {
        const page = await api<ChangeEventList>({
            path: '/change-events',
            query: {
                source: sourceFilter.value === ALL ? undefined : sourceFilter.value,
                status: statusFilter.value === ALL ? undefined : statusFilter.value,
                limit: 50,
            },
        })
        extraPages.value = []
        nextCursor.value = page.next_cursor
        return page
    },
    { watch: [sourceFilter, statusFilter] },
)

const feedEvents = computed(() => [...(feed.value?.data ?? []), ...extraPages.value])
const sourceItems = [
    { label: 'All sources', value: ALL },
    ...CHANGE_SOURCES.map(source => ({ label: CHANGE_SOURCE_LABELS[source], value: source })),
]
const statusItems = [
    { label: 'Any status', value: ALL },
    { label: 'Applied', value: 'applied' },
    { label: 'Needs review', value: 'pending' },
    { label: 'Rejected', value: 'rejected' },
    { label: 'Reverted', value: 'reverted' },
    { label: 'Out of date', value: 'superseded' },
]

const { busyEventId, acceptChange, rejectChange, revertChange } = useChangeEventActions({ onChanged: reloadActivity })

/**
 * Reload everything on the page.
 *
 * @returns Resolves once fresh.
 */
async function reloadActivity() {
    await Promise.all([refreshSummary(), refreshPending(), refreshDrafts(), refreshFeed()])
}

/**
 * Load the next page of the feed.
 *
 * @returns Resolves once appended.
 */
async function loadMore() {
    if (!nextCursor.value) {
        return
    }
    isLoadingMore.value = true
    try {
        const page = await api<ChangeEventList>({
            path: '/change-events',
            query: {
                source: sourceFilter.value === ALL ? undefined : sourceFilter.value,
                status: statusFilter.value === ALL ? undefined : statusFilter.value,
                cursor: nextCursor.value,
                limit: 50,
            },
        })
        extraPages.value = [...extraPages.value, ...page.data]
        nextCursor.value = page.next_cursor
    } finally {
        isLoadingMore.value = false
    }
}

/**
 * Confirm or discard an AI-drafted funder.
 *
 * @param input.funderId - The draft.
 * @param input.action - `confirm` adds it to the pipeline; `archive` discards it.
 * @returns Resolves once done.
 */
async function resolveDraft({ funderId, action }: { funderId: string; action: 'confirm' | 'archive' }) {
    busyFunderId.value = funderId
    try {
        await api({ path: `/funders/${funderId}/${action}`, method: 'POST' })
        toast.add({
            title: action === 'confirm' ? 'Funder added to the pipeline' : 'Draft discarded',
            color: 'success',
        })
        await reloadActivity()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        busyFunderId.value = null
    }
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Activity">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <div class="mx-auto w-full max-w-4xl space-y-6">
                <UCard v-if="drafts?.data.length" :ui="{ body: 'p-0 sm:p-0' }">
                    <template #header>
                        <h2 class="font-medium text-highlighted">New funders from forwarded email</h2>
                        <p class="text-xs text-muted">
                            The AI drafted these from emails someone forwarded. Confirm to add them to the pipeline.
                        </p>
                    </template>
                    <ul class="divide-y divide-default">
                        <li v-for="draft in drafts.data" :key="draft.id" class="flex items-start gap-3 px-4 py-3">
                            <UIcon name="i-lucide-sparkles" class="mt-0.5 size-4 text-warning" />
                            <div class="min-w-0 flex-1">
                                <NuxtLink
                                    :to="`/pipeline/funders/${draft.id}`"
                                    class="font-medium text-highlighted hover:underline"
                                >
                                    {{ draft.name }}
                                </NuxtLink>
                                <p class="text-sm text-muted">{{ draft.notes }}</p>
                            </div>
                            <UButton
                                size="sm"
                                color="success"
                                label="Add to pipeline"
                                :loading="busyFunderId === draft.id"
                                @click="resolveDraft({ funderId: draft.id, action: 'confirm' })"
                            />
                            <UButton
                                size="sm"
                                color="neutral"
                                variant="ghost"
                                label="Discard"
                                @click="resolveDraft({ funderId: draft.id, action: 'archive' })"
                            />
                        </li>
                    </ul>
                </UCard>

                <UCard v-if="pending?.data.length">
                    <template #header>
                        <h2 class="font-medium text-highlighted">
                            Needs review ({{ summary?.pending_changes ?? pending.data.length }})
                        </h2>
                        <p class="text-xs text-muted">
                            Suggestions the AI wasn't sure enough about, or that mark an ask lost or lower an amount.
                        </p>
                    </template>
                    <div class="divide-y divide-default">
                        <ActivityChangeCard
                            v-for="event in pending.data"
                            :key="event.id"
                            :event="event"
                            :is-busy="busyEventId === event.id"
                            @accept="acceptChange"
                            @reject="rejectChange"
                            @edited="reloadActivity"
                        />
                    </div>
                </UCard>

                <UCard>
                    <template #header>
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <h2 class="font-medium text-highlighted">All changes</h2>
                            <div class="flex gap-2">
                                <USelect v-model="sourceFilter" :items="sourceItems" class="w-48" />
                                <USelect v-model="statusFilter" :items="statusItems" class="w-36" />
                            </div>
                        </div>
                    </template>
                    <PipelineChangeTimeline
                        v-if="feedEvents.length"
                        :events="feedEvents"
                        show-entity-name
                        :busy-event-id="busyEventId"
                        @accept="acceptChange"
                        @reject="rejectChange"
                        @revert="revertChange"
                    />
                    <p v-else class="text-sm text-muted">No changes match.</p>
                    <div v-if="nextCursor" class="mt-4 flex justify-center">
                        <UButton label="Load more" color="neutral" :loading="isLoadingMore" @click="loadMore" />
                    </div>
                </UCard>
            </div>
        </template>
    </UDashboardPanel>
</template>
