<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAsyncData, useRoute, useRouter, useSeoMeta, useToast } from '#imports'
import { GOAL_TYPE_DETAILS, MILESTONE_KIND_DETAILS } from '#shared/constants/pipeline.ts'
import type { Milestone, MilestoneList, Task, TaskList, UserSummary } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { usePipelineReference } from '~/composables/usePipelineReference.ts'
import { useTaskActions } from '~/composables/useTaskActions.ts'
import { useTaskReference } from '~/composables/useTaskReference.ts'
import { formatDate } from '~/utils/format.ts'

useSeoMeta({ title: 'Milestones & Tasks · Earth Bank Dashboard' })

const api = useApi()
const route = useRoute()
const router = useRouter()
const { team } = usePipelineReference()
const taskReference = useTaskReference()
const toast = useToast()

type MilestonesView = 'milestones' | 'people'
const view = ref<MilestonesView>(route.query.view === 'people' ? 'people' : 'milestones')
const showDone = ref(false)

const { data: milestoneList, refresh: refreshMilestones } = await useAsyncData(
    'milestones.list',
    () => api<MilestoneList>({ path: '/milestones', query: { include_done: showDone.value } }),
    { watch: [showDone] },
)
const { data: taskList, refresh: refreshTasks } = await useAsyncData(
    'milestones.tasks',
    () => api<TaskList>({ path: '/tasks', query: { include_done: showDone.value } }),
    { watch: [showDone] },
)

const { updatingTaskId, toggleDone } = useTaskActions({ onChanged: reloadAll })

// The task slideover opens from ?task=<id> so emailed links land on the task.
const openTaskId = computed(() => (typeof route.query.task === 'string' ? route.query.task : null))
const isTaskOpen = computed({
    get: () => openTaskId.value !== null,
    set: isOpen => {
        if (!isOpen) {
            router.replace({ query: { ...route.query, task: undefined } })
        }
    },
})

watch(view, value => router.replace({ query: { ...route.query, view: value === 'people' ? 'people' : undefined } }))

const isMilestoneModalOpen = ref(false)
const editingMilestone = ref<Milestone | null>(null)
const isTaskModalOpen = ref(false)
const newTaskMilestoneId = ref<string | null>(null)

const tasksByMilestone = computed(() => {
    const groups = new Map<string, Task[]>()
    for (const task of taskList.value?.data ?? []) {
        const key = task.milestone?.id ?? 'none'
        groups.set(key, [...(groups.get(key) ?? []), task])
    }
    for (const tasks of groups.values()) {
        tasks.sort((first, second) => first.sort - second.sort)
    }
    return groups
})

const people = computed(() => {
    const tasks = taskList.value?.data ?? []
    const members: (UserSummary | null)[] = [
        ...(team.data.value?.data ?? []).filter(user => !user.deactivated_at),
        null,
    ]
    return members
        .map(member => {
            const memberTasks = tasks.filter(task => (task.assignee?.id ?? null) === (member?.id ?? null))
            const openTasks = memberTasks.filter(task => task.status !== 'done')
            const nextDeadline =
                openTasks
                    .map(task => task.due_at)
                    .filter(Boolean)
                    .sort()[0] ?? null
            return { member, tasks: memberTasks, openCount: openTasks.length, nextDeadline }
        })
        .filter(group => group.member !== null || group.tasks.length > 0)
})

/**
 * Show a task in the slideover.
 *
 * @param task - The task.
 * @returns Nothing.
 */
function openTask(task: Task) {
    router.replace({ query: { ...route.query, task: task.id } })
}

/**
 * Open the milestone form.
 *
 * @param input.milestone - Milestone to edit, or null for a new one.
 * @returns Nothing.
 */
function openMilestoneForm({ milestone }: { milestone: Milestone | null }) {
    editingMilestone.value = milestone
    isMilestoneModalOpen.value = true
}

/**
 * Open the new-task form, optionally inside a milestone.
 *
 * @param input.milestoneId - Milestone to add the task to.
 * @returns Nothing.
 */
function openTaskForm({ milestoneId }: { milestoneId: string | null }) {
    newTaskMilestoneId.value = milestoneId
    isTaskModalOpen.value = true
}

/**
 * Reload milestones, tasks and the form option lists.
 *
 * @returns Resolves once everything is fresh.
 */
async function reloadAll() {
    await Promise.all([refreshMilestones(), refreshTasks(), taskReference.milestones.refresh()])
}

/**
 * Save a new task order after a drag, then reload so every view agrees. On failure the list is
 * reloaded to the saved order and the error is shown.
 *
 * @param input.taskIds - Task ids of one group, in their new order.
 * @returns Resolves once saved and reloaded.
 */
async function saveTaskOrder({ taskIds }: { taskIds: string[] }) {
    try {
        await api({ path: '/tasks/reorder', method: 'POST', body: { task_ids: taskIds } })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error, fallback: 'Could not save the new order.' }), color: 'error' })
    }
    await refreshTasks()
}

/**
 * Short summary of what someone has to do, e.g. "3 open tasks · next due Jan 1".
 *
 * @param input.openCount - Open tasks.
 * @param input.nextDeadline - Earliest deadline, if any.
 * @returns The summary.
 */
function personSummary({ openCount, nextDeadline }: { openCount: number; nextDeadline: string | null }) {
    const tasks = `${openCount} open task${openCount === 1 ? '' : 's'}`
    return nextDeadline ? `${tasks} · next due ${formatDate({ value: nextDeadline })}` : tasks
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Milestones & Tasks">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
                <template #right>
                    <UButton
                        icon="i-lucide-flag"
                        label="New milestone"
                        @click="openMilestoneForm({ milestone: null })"
                    />
                    <UButton
                        icon="i-lucide-plus"
                        label="New task"
                        variant="solid"
                        @click="openTaskForm({ milestoneId: null })"
                    />
                </template>
            </UDashboardNavbar>
            <UDashboardToolbar>
                <template #left>
                    <UTabs
                        v-model="view"
                        :items="[
                            { label: 'By milestone', value: 'milestones', icon: 'i-lucide-flag' },
                            { label: 'By person', value: 'people', icon: 'i-lucide-users' },
                        ]"
                        :content="false"
                        size="sm"
                    />
                </template>
                <template #right>
                    <USwitch v-model="showDone" label="Show done" />
                </template>
            </UDashboardToolbar>
        </template>

        <template #body>
            <div v-if="view === 'milestones'" class="mx-auto w-full max-w-4xl space-y-4">
                <UCard v-for="milestone in milestoneList?.data ?? []" :key="milestone.id" :ui="{ body: 'p-0 sm:p-0' }">
                    <template #header>
                        <div class="flex items-start gap-3">
                            <UIcon :name="MILESTONE_KIND_DETAILS[milestone.kind].icon" class="mt-1 size-5 text-muted" />
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <h2 class="font-medium text-highlighted">{{ milestone.title }}</h2>
                                    <UBadge v-if="milestone.status === 'done'" label="Done" color="success" size="sm" />
                                    <UBadge v-else-if="milestone.is_overdue" label="Overdue" color="error" size="sm" />
                                    <UBadge
                                        v-if="milestone.goal_type"
                                        :label="GOAL_TYPE_DETAILS[milestone.goal_type].label"
                                        :color="GOAL_TYPE_DETAILS[milestone.goal_type].color"
                                        size="sm"
                                    />
                                </div>
                                <p class="text-sm text-muted">
                                    {{ formatDate({ value: milestone.due_at }) }}
                                    <template v-if="milestone.opportunity">
                                        ·
                                        <NuxtLink
                                            :to="`/pipeline/funders/${milestone.opportunity.funder.id}`"
                                            class="hover:underline"
                                        >
                                            {{ milestone.opportunity.funder.name }}
                                        </NuxtLink>
                                    </template>
                                </p>
                                <p v-if="milestone.description" class="mt-1 text-sm">{{ milestone.description }}</p>
                            </div>
                            <div class="flex items-center gap-3">
                                <div v-if="milestone.task_counts.total" class="w-24 text-right">
                                    <p class="text-xs text-muted">
                                        {{ milestone.task_counts.done }}/{{ milestone.task_counts.total }} done
                                    </p>
                                    <UProgress
                                        :model-value="(milestone.task_counts.done / milestone.task_counts.total) * 100"
                                        size="xs"
                                        :color="milestone.is_overdue ? 'error' : 'primary'"
                                    />
                                </div>
                                <UButton
                                    icon="i-lucide-pencil"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    aria-label="Edit milestone"
                                    @click="openMilestoneForm({ milestone })"
                                />
                            </div>
                        </div>
                    </template>
                    <div class="divide-y divide-default">
                        <TasksSortableList
                            :tasks="tasksByMilestone.get(milestone.id) ?? []"
                            :updating-task-id="updatingTaskId"
                            @open="openTask"
                            @toggle-done="toggleDone"
                            @reorder="saveTaskOrder({ taskIds: $event })"
                        />
                        <div class="px-3 py-2">
                            <UButton
                                icon="i-lucide-plus"
                                label="Add task"
                                size="xs"
                                color="neutral"
                                variant="ghost"
                                @click="openTaskForm({ milestoneId: milestone.id })"
                            />
                        </div>
                    </div>
                </UCard>

                <UCard v-if="tasksByMilestone.get('none')?.length" :ui="{ body: 'p-0 sm:p-0' }">
                    <template #header>
                        <h2 class="font-medium text-highlighted">Other tasks</h2>
                    </template>
                    <TasksSortableList
                        :tasks="tasksByMilestone.get('none') ?? []"
                        :updating-task-id="updatingTaskId"
                        @open="openTask"
                        @toggle-done="toggleDone"
                        @reorder="saveTaskOrder({ taskIds: $event })"
                    />
                </UCard>

                <UEmpty
                    v-if="!milestoneList?.data.length && !taskList?.data.length"
                    icon="i-lucide-flag"
                    title="No milestones yet"
                    description="Add the funding milestones and events that matter, then the tasks that get you there."
                    :actions="[
                        {
                            label: 'New milestone',
                            icon: 'i-lucide-flag',
                            onClick: () => openMilestoneForm({ milestone: null }),
                        },
                    ]"
                />
            </div>

            <div v-else class="mx-auto w-full max-w-4xl space-y-4">
                <UCard v-for="group in people" :key="group.member?.id ?? 'unassigned'" :ui="{ body: 'p-0 sm:p-0' }">
                    <template #header>
                        <div class="flex items-center gap-3">
                            <UAvatar
                                :src="group.member?.avatar_url ?? undefined"
                                :alt="group.member?.name ?? 'Unassigned'"
                                :icon="group.member ? undefined : 'i-lucide-user-round'"
                            />
                            <div>
                                <h2 class="font-medium text-highlighted">{{ group.member?.name ?? 'Unassigned' }}</h2>
                                <p class="text-sm text-muted">
                                    {{
                                        personSummary({ openCount: group.openCount, nextDeadline: group.nextDeadline })
                                    }}
                                </p>
                            </div>
                        </div>
                    </template>
                    <div v-if="group.tasks.length" class="divide-y divide-default">
                        <TasksRow
                            v-for="task in group.tasks"
                            :key="task.id"
                            :task="task"
                            show-milestone
                            hide-assignee
                            :is-updating="updatingTaskId === task.id"
                            @open="openTask"
                            @toggle-done="toggleDone"
                        />
                    </div>
                    <p v-else class="px-4 py-4 text-sm text-muted">Nothing assigned.</p>
                </UCard>
            </div>

            <MilestonesModal v-model:open="isMilestoneModalOpen" :milestone="editingMilestone" @saved="reloadAll" />
            <TasksCreateModal v-model:open="isTaskModalOpen" :milestone-id="newTaskMilestoneId" @created="reloadAll" />
            <TasksSlideover v-model:open="isTaskOpen" :task-id="openTaskId" @changed="reloadAll" />
        </template>
    </UDashboardPanel>
</template>
