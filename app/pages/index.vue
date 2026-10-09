<script setup lang="ts">
import { computed } from 'vue'
import { navigateTo, useAsyncData, useSeoMeta } from '#imports'
import { MILESTONE_KIND_DETAILS } from '#shared/constants/pipeline.ts'
import type { RunwayEnd } from '#shared/forecast/project-runway.ts'
import type { CashSummary, ChangeEventList, MilestoneList, TaskList } from '#shared/schemas/index.ts'
import { addDays } from '#shared/utils/calendar-dates.ts'
import { useApi } from '~/composables/useApi.ts'
import { useAuth } from '~/composables/useAuth.ts'
import { useChangeEventActions } from '~/composables/useChangeEventActions.ts'
import { useForecast } from '~/composables/useForecast.ts'
import { usePipelineReference } from '~/composables/usePipelineReference.ts'
import { useTaskActions } from '~/composables/useTaskActions.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'

useSeoMeta({ title: 'Overview · Earth Bank Dashboard' })

const api = useApi()
const { currentUser } = useAuth()
const { goals } = usePipelineReference()
const { inputs, isReady, baseProjection } = useForecast()

const { data: cash } = await useAsyncData('overview.cash', () => api<CashSummary>({ path: '/cash/summary' }))
const { data: milestones } = await useAsyncData('overview.milestones', () =>
    api<MilestoneList>({ path: '/milestones' }),
)
const { data: myTasks, refresh: refreshMyTasks } = await useAsyncData('overview.my-tasks', () =>
    api<TaskList>({ path: '/tasks', query: { assignee_id: currentUser.value?.id } }),
)
const { data: recentChanges, refresh: refreshChanges } = await useAsyncData('overview.changes', () =>
    api<ChangeEventList>({ path: '/change-events', query: { limit: 8 } }),
)
await inputs

const { updatingTaskId, toggleDone } = useTaskActions({ onChanged: () => refreshMyTasks() })
const { busyEventId, acceptChange, rejectChange, revertChange } = useChangeEventActions({
    onChanged: () => refreshChanges(),
})

const upcomingMilestones = computed(() => {
    const horizon = addDays({ value: inputs.data.value?.today ?? new Date().toISOString().slice(0, 10), days: 60 })
    return (milestones.value?.data ?? []).filter(milestone => milestone.due_at <= horizon).slice(0, 6)
})

const runwayTiles = computed(() => {
    const projection = baseProjection.value
    return projection
        ? [
              { label: 'Runway on committed money', end: projection.runway.committed, color: 'text-highlighted' },
              { label: 'Runway with weighted pipeline', end: projection.runway.weighted, color: 'text-muted' },
          ]
        : []
})

/**
 * Describe a runway end: "7.4 months · until Jun 12, 2027", or "24+ months".
 *
 * @param input.end - The runway end.
 * @returns `{ headline, detail }`.
 */
function describeRunway({ end }: { end: RunwayEnd }) {
    if (!end.out_date) {
        return { headline: '24+ months', detail: 'Cash lasts beyond the forecast horizon' }
    }
    return { headline: `${end.months} months`, detail: `Cash runs out around ${formatDate({ value: end.out_date })}` }
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Overview">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
                <template #right>
                    <UButton to="/forecast" icon="i-lucide-chart-line" label="Open forecast" />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <div class="space-y-6">
                <UAlert
                    v-if="!isReady"
                    color="warning"
                    icon="i-lucide-landmark"
                    title="Cash on hand isn't known yet"
                    description="Connect Bookeeping.ai (set BOOKEEPING_API_KEY) or enter today's balance and burn in Settings → Cash to see runway."
                    :actions="[{ label: 'Cash settings', to: '/settings/cash', color: 'warning', variant: 'solid' }]"
                />

                <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <UCard>
                        <p class="text-sm text-muted">Cash on hand</p>
                        <p class="mt-1 text-3xl font-semibold text-highlighted">
                            {{ formatMoney({ cents: cash?.balance_cents, compact: true, unknown: 'Not set' }) }}
                        </p>
                        <p class="mt-1 text-xs text-muted">
                            <template v-if="cash?.balance_source === 'bookeeping'">
                                Bookeeping.ai · {{ formatDate({ value: cash.balance_as_of }) }}
                            </template>
                            <template v-else-if="cash?.balance_source === 'manual'">
                                Entered by hand · {{ formatDate({ value: cash.balance_as_of }) }}
                            </template>
                            <template v-else>No balance yet</template>
                        </p>
                    </UCard>
                    <UCard>
                        <p class="text-sm text-muted">Monthly burn</p>
                        <p class="mt-1 text-3xl font-semibold text-highlighted">
                            {{ formatMoney({ cents: cash?.monthly_burn_cents, compact: true, unknown: 'Not set' }) }}
                        </p>
                        <p class="mt-1 text-xs text-muted">
                            {{
                                cash?.burn_source === 'override'
                                    ? 'Set by hand'
                                    : cash?.burn_source === 'computed'
                                      ? 'Average of recent months'
                                      : 'No spending history yet'
                            }}
                        </p>
                    </UCard>
                    <UCard v-for="tile in runwayTiles" :key="tile.label">
                        <p class="text-sm text-muted">{{ tile.label }}</p>
                        <p class="mt-1 text-3xl font-semibold" :class="tile.color">
                            {{ describeRunway({ end: tile.end }).headline }}
                        </p>
                        <p class="mt-1 text-xs text-muted">{{ describeRunway({ end: tile.end }).detail }}</p>
                    </UCard>
                </div>

                <UCard v-if="baseProjection">
                    <template #header>
                        <div class="flex items-center justify-between">
                            <h2 class="font-medium text-highlighted">Cash runway</h2>
                            <UButton
                                to="/forecast"
                                label="Model a scenario"
                                size="sm"
                                trailing-icon="i-lucide-arrow-right"
                            />
                        </div>
                    </template>
                    <ForecastRunwayChart :projection="baseProjection" :height="240" />
                </UCard>

                <PipelineGoalSummary v-if="goals.data.value" :goals="goals.data.value.data" />

                <div class="grid gap-6 lg:grid-cols-2">
                    <UCard :ui="{ body: 'p-0 sm:p-0' }">
                        <template #header>
                            <div class="flex items-center justify-between">
                                <h2 class="font-medium text-highlighted">My tasks</h2>
                                <UButton
                                    to="/milestones?view=people"
                                    label="All tasks"
                                    size="xs"
                                    color="neutral"
                                    variant="ghost"
                                />
                            </div>
                        </template>
                        <div v-if="myTasks?.data.length" class="divide-y divide-default">
                            <TasksRow
                                v-for="task in myTasks.data.slice(0, 8)"
                                :key="task.id"
                                :task="task"
                                show-milestone
                                hide-assignee
                                :is-updating="updatingTaskId === task.id"
                                @open="task => navigateTo(`/milestones?task=${task.id}`)"
                                @toggle-done="toggleDone"
                            />
                        </div>
                        <p v-else class="px-4 py-6 text-center text-sm text-muted">Nothing assigned to you.</p>
                    </UCard>

                    <UCard :ui="{ body: 'p-0 sm:p-0' }">
                        <template #header>
                            <div class="flex items-center justify-between">
                                <h2 class="font-medium text-highlighted">Coming up</h2>
                                <UButton
                                    to="/milestones"
                                    label="All milestones"
                                    size="xs"
                                    color="neutral"
                                    variant="ghost"
                                />
                            </div>
                        </template>
                        <ul v-if="upcomingMilestones.length" class="divide-y divide-default">
                            <li
                                v-for="milestone in upcomingMilestones"
                                :key="milestone.id"
                                class="flex items-center gap-3 px-4 py-3"
                            >
                                <UIcon :name="MILESTONE_KIND_DETAILS[milestone.kind].icon" class="size-4 text-muted" />
                                <div class="min-w-0 flex-1">
                                    <p class="truncate text-sm font-medium text-highlighted">{{ milestone.title }}</p>
                                    <p class="text-xs" :class="milestone.is_overdue ? 'text-error' : 'text-muted'">
                                        {{ milestone.is_overdue ? 'Overdue · ' : ''
                                        }}{{ formatDate({ value: milestone.due_at }) }}
                                    </p>
                                </div>
                                <span v-if="milestone.task_counts.total" class="text-xs text-muted">
                                    {{ milestone.task_counts.done }}/{{ milestone.task_counts.total }} tasks
                                </span>
                            </li>
                        </ul>
                        <p v-else class="px-4 py-6 text-center text-sm text-muted">
                            No milestones in the next 60 days.
                        </p>
                    </UCard>
                </div>

                <UCard>
                    <template #header>
                        <div class="flex items-center justify-between">
                            <h2 class="font-medium text-highlighted">Recent pipeline changes</h2>
                            <UButton to="/activity" label="Activity" size="xs" color="neutral" variant="ghost" />
                        </div>
                    </template>
                    <PipelineChangeTimeline
                        v-if="recentChanges?.data.length"
                        :events="recentChanges.data"
                        show-entity-name
                        :busy-event-id="busyEventId"
                        @accept="acceptChange"
                        @reject="rejectChange"
                        @revert="revertChange"
                    />
                    <p v-else class="text-sm text-muted">No changes yet.</p>
                </UCard>
            </div>
        </template>
    </UDashboardPanel>
</template>
