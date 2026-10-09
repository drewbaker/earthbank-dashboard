<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAsyncData, useRoute, useSeoMeta, useToast } from '#imports'
import { FUNDER_KIND_LABELS } from '#shared/constants/pipeline.ts'
import type { ChangeEventList, Contact, FunderDetail, Opportunity, Task, TaskList } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { useChangeEventActions } from '~/composables/useChangeEventActions.ts'
import { useTaskActions } from '~/composables/useTaskActions.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'

const route = useRoute()
const api = useApi()
const toast = useToast()
const funderId = computed(() => String(route.params.id))

const {
    data: funder,
    refresh: refreshFunder,
    error: loadError,
} = await useAsyncData(`funder.${funderId.value}`, () => api<FunderDetail>({ path: `/funders/${funderId.value}` }))
const { data: changeLog, refresh: refreshChangeLog } = await useAsyncData(`funder.${funderId.value}.changes`, () =>
    api<ChangeEventList>({ path: '/change-events', query: { funder_id: funderId.value, limit: 50 } }),
)

const { data: taskList, refresh: refreshTasks } = await useAsyncData(`funder.${funderId.value}.tasks`, () =>
    api<TaskList>({ path: '/tasks', query: { funder_id: funderId.value, include_done: true } }),
)

useSeoMeta({ title: () => `${funder.value?.name ?? 'Funder'} · Earth Bank Dashboard` })

const isTaskModalOpen = ref(false)
const openTaskId = ref<string | null>(null)
const isTaskOpen = ref(false)
const { updatingTaskId, toggleDone } = useTaskActions({ onChanged: () => refreshTasks() })

/**
 * Show a task in the slideover.
 *
 * @param task - The task.
 * @returns Nothing.
 */
function openTask(task: Task) {
    openTaskId.value = task.id
    isTaskOpen.value = true
}

const isFunderModalOpen = ref(false)
const isOpportunityModalOpen = ref(false)
const isContactModalOpen = ref(false)
const editingOpportunity = ref<Opportunity | null>(null)
const editingContact = ref<Contact | null>(null)
const isArchiving = ref(false)
const isEmailDraftOpen = ref(false)
const emailDraftOpportunityId = ref<string | null>(null)

/**
 * Open the AI email draft, optionally about one opportunity.
 *
 * @param input.opportunityId - The opportunity the email is about, or null.
 * @returns Nothing.
 */
function openEmailDraft({ opportunityId }: { opportunityId: string | null }) {
    emailDraftOpportunityId.value = opportunityId
    isEmailDraftOpen.value = true
}

const { busyEventId, acceptChange, rejectChange, revertChange } = useChangeEventActions({ onChanged: reloadFunder })

const details = computed(() => {
    const current = funder.value
    if (!current) {
        return []
    }
    return [
        { label: 'Kind', value: FUNDER_KIND_LABELS[current.kind] },
        { label: 'Geo focus', value: current.geo_focus ?? '—' },
        { label: 'Potential size', value: current.potential_size ?? '—' },
        { label: 'Owner', value: current.owner?.name ?? 'Unassigned' },
        { label: 'Last contact', value: formatDate({ value: current.last_contact_at, unknown: 'None logged' }) },
        { label: 'Materials sent', value: formatDate({ value: current.materials_sent_at, unknown: 'Not yet' }) },
    ]
})

/**
 * Reload the funder and its change log.
 *
 * @returns Resolves once both are fresh.
 */
async function reloadFunder() {
    await Promise.all([refreshFunder(), refreshChangeLog(), refreshTasks()])
}

/**
 * Open the opportunity form, for a new opportunity or an existing one.
 *
 * @param input.opportunity - The opportunity to edit, or null to add one.
 * @returns Nothing.
 */
function openOpportunityForm({ opportunity }: { opportunity: Opportunity | null }) {
    editingOpportunity.value = opportunity
    isOpportunityModalOpen.value = true
}

/**
 * Open the contact form, for a new contact or an existing one.
 *
 * @param input.contact - The contact to edit, or null to add one.
 * @returns Nothing.
 */
function openContactForm({ contact }: { contact: Contact | null }) {
    editingContact.value = contact
    isContactModalOpen.value = true
}

/**
 * Remove a contact, then reload.
 *
 * @param input.contact - The contact.
 * @returns Resolves once removed.
 */
async function removeContact({ contact }: { contact: Contact }) {
    try {
        await api({ path: `/contacts/${contact.id}`, method: 'DELETE' })
        toast.add({ title: `${contact.name} removed`, color: 'success' })
        await reloadFunder()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    }
}

/**
 * Archive or restore the funder.
 *
 * @returns Resolves once done.
 */
async function toggleArchived() {
    if (!funder.value) {
        return
    }
    isArchiving.value = true
    const action = funder.value.archived_at ? 'restore' : 'archive'
    try {
        await api({ path: `/funders/${funder.value.id}/${action}`, method: 'POST' })
        toast.add({ title: action === 'archive' ? 'Funder archived' : 'Funder restored', color: 'success' })
        await reloadFunder()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isArchiving.value = false
    }
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar :title="funder?.name ?? 'Funder'">
                <template #leading>
                    <UDashboardSidebarCollapse />
                    <UButton
                        to="/pipeline"
                        icon="i-lucide-arrow-left"
                        color="neutral"
                        variant="ghost"
                        aria-label="Back to pipeline"
                    />
                </template>
                <template #right>
                    <template v-if="funder">
                        <UButton
                            :label="funder.archived_at ? 'Restore' : 'Archive'"
                            :icon="funder.archived_at ? 'i-lucide-archive-restore' : 'i-lucide-archive'"
                            color="neutral"
                            variant="ghost"
                            :loading="isArchiving"
                            @click="toggleArchived"
                        />
                        <UButton label="Edit" icon="i-lucide-pencil" @click="isFunderModalOpen = true" />
                        <UButton
                            label="Draft email"
                            icon="i-lucide-sparkles"
                            :variant="funder.awaiting_reply_since ? 'solid' : 'soft'"
                            @click="openEmailDraft({ opportunityId: null })"
                        />
                    </template>
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UEmpty
                v-if="loadError || !funder"
                icon="i-lucide-search-x"
                title="Funder not found"
                description="It may have been removed."
                :actions="[{ label: 'Back to pipeline', to: '/pipeline' }]"
            />

            <div v-else class="grid gap-6 lg:grid-cols-3">
                <div class="space-y-6 lg:col-span-2">
                    <UAlert
                        v-if="funder.archived_at"
                        color="neutral"
                        icon="i-lucide-archive"
                        title="Archived"
                        description="This funder is hidden from the pipeline and totals."
                    />
                    <UAlert
                        v-if="funder.status === 'draft'"
                        color="warning"
                        icon="i-lucide-sparkles"
                        title="Draft from a forwarded email"
                        description="Check the details, then confirm it on the Activity page."
                    />

                    <div class="flex flex-wrap items-center gap-2">
                        <PipelineTierBadge :tier="funder.tier" />
                        <PipelineRelationshipBadge :status="funder.relationship_status" />
                        <UBadge
                            v-if="funder.awaiting_reply_since"
                            :label="`Reply needed · they wrote ${formatDate({ value: funder.awaiting_reply_since, style: 'short' })}`"
                            icon="i-lucide-reply"
                            color="info"
                        />
                        <PipelineGoalBadge
                            v-for="goalType in funder.goal_types"
                            :key="goalType"
                            :goal-type="goalType"
                        />
                    </div>

                    <UCard :ui="{ body: 'p-0 sm:p-0' }">
                        <template #header>
                            <div class="flex items-center justify-between">
                                <h2 class="font-medium text-highlighted">Opportunities</h2>
                                <UButton
                                    size="sm"
                                    icon="i-lucide-plus"
                                    label="Add"
                                    @click="openOpportunityForm({ opportunity: null })"
                                />
                            </div>
                        </template>
                        <ul v-if="funder.opportunities.length" class="divide-y divide-default">
                            <li
                                v-for="opportunity in funder.opportunities"
                                :key="opportunity.id"
                                class="flex items-start hover:bg-elevated/50"
                            >
                                <button
                                    type="button"
                                    class="flex min-w-0 flex-1 items-start gap-4 py-3 pl-4 text-left"
                                    @click="openOpportunityForm({ opportunity })"
                                >
                                    <div class="min-w-0 flex-1 space-y-1">
                                        <div class="flex flex-wrap items-center gap-2">
                                            <span class="font-medium text-highlighted">{{ opportunity.name }}</span>
                                            <PipelineGoalBadge :goal-type="opportunity.goal_type" />
                                            <PipelineStageBadge :stage="opportunity.stage" />
                                        </div>
                                        <p v-if="opportunity.next_step" class="text-sm text-muted">
                                            Next: {{ opportunity.next_step }}
                                        </p>
                                        <p class="text-xs text-dimmed">
                                            Expected
                                            {{
                                                formatDate({
                                                    value: opportunity.expected_receipt_at,
                                                    unknown: 'date not set',
                                                })
                                            }}
                                            <template v-if="opportunity.owner">
                                                · {{ opportunity.owner.name }}</template
                                            >
                                        </p>
                                    </div>
                                    <div class="text-right">
                                        <p class="font-medium text-highlighted">
                                            {{ formatMoney({ cents: opportunity.amount_cents }) }}
                                        </p>
                                        <p class="text-xs text-muted">
                                            {{ opportunity.probability }}% ·
                                            {{
                                                formatMoney({ cents: opportunity.weighted_amount_cents, compact: true })
                                            }}
                                            weighted
                                        </p>
                                    </div>
                                </button>
                                <UTooltip text="Draft an email about this">
                                    <UButton
                                        icon="i-lucide-mail-plus"
                                        color="neutral"
                                        variant="ghost"
                                        size="sm"
                                        class="m-2"
                                        :aria-label="`Draft an email about ${opportunity.name}`"
                                        @click="openEmailDraft({ opportunityId: opportunity.id })"
                                    />
                                </UTooltip>
                            </li>
                        </ul>
                        <p v-else class="px-4 py-6 text-center text-sm text-muted">No opportunities yet.</p>
                    </UCard>

                    <PipelineFunderEmails :funder-id="funder.id" />

                    <UCard :ui="{ body: 'p-0 sm:p-0' }">
                        <template #header>
                            <div class="flex items-center justify-between">
                                <h2 class="font-medium text-highlighted">Tasks</h2>
                                <UButton size="sm" icon="i-lucide-plus" label="Add" @click="isTaskModalOpen = true" />
                            </div>
                        </template>
                        <div v-if="taskList?.data.length" class="divide-y divide-default">
                            <TasksRow
                                v-for="task in taskList.data"
                                :key="task.id"
                                :task="task"
                                show-milestone
                                :is-updating="updatingTaskId === task.id"
                                @open="openTask"
                                @toggle-done="toggleDone"
                            />
                        </div>
                        <p v-else class="px-4 py-6 text-center text-sm text-muted">No tasks for this funder.</p>
                    </UCard>

                    <UCard v-if="funder.notes">
                        <template #header>
                            <h2 class="font-medium text-highlighted">Notes</h2>
                        </template>
                        <p class="text-sm whitespace-pre-line">{{ funder.notes }}</p>
                    </UCard>

                    <UCard>
                        <template #header>
                            <h2 class="font-medium text-highlighted">History</h2>
                        </template>
                        <PipelineChangeTimeline
                            v-if="changeLog?.data.length"
                            :events="changeLog.data"
                            :busy-event-id="busyEventId"
                            @accept="acceptChange"
                            @reject="rejectChange"
                            @revert="revertChange"
                        />
                        <p v-else class="text-sm text-muted">No changes recorded yet.</p>
                    </UCard>
                </div>

                <div class="space-y-6">
                    <UCard>
                        <template #header>
                            <h2 class="font-medium text-highlighted">Details</h2>
                        </template>
                        <dl class="space-y-3 text-sm">
                            <div v-for="detail in details" :key="detail.label" class="flex justify-between gap-4">
                                <dt class="text-muted">{{ detail.label }}</dt>
                                <dd class="text-right text-highlighted">{{ detail.value }}</dd>
                            </div>
                            <div>
                                <dt class="text-muted">Email domains</dt>
                                <dd class="mt-1 flex flex-wrap gap-1">
                                    <UBadge
                                        v-for="domain in funder.email_domains"
                                        :key="domain"
                                        color="neutral"
                                        :label="domain"
                                        size="sm"
                                    />
                                    <span v-if="!funder.email_domains.length" class="text-dimmed">None</span>
                                </dd>
                            </div>
                            <p v-if="funder.last_contact_note" class="text-xs text-muted">
                                {{ funder.last_contact_note }}
                            </p>
                        </dl>
                    </UCard>

                    <UCard :ui="{ body: 'p-0 sm:p-0' }">
                        <template #header>
                            <div class="flex items-center justify-between">
                                <h2 class="font-medium text-highlighted">Contacts</h2>
                                <UButton
                                    size="sm"
                                    icon="i-lucide-plus"
                                    label="Add"
                                    @click="openContactForm({ contact: null })"
                                />
                            </div>
                        </template>
                        <ul v-if="funder.contacts.length" class="divide-y divide-default">
                            <li
                                v-for="contact in funder.contacts"
                                :key="contact.id"
                                class="flex items-start gap-3 px-4 py-3"
                            >
                                <UAvatar :alt="contact.name" size="sm" />
                                <div class="min-w-0 flex-1">
                                    <p class="text-sm font-medium text-highlighted">{{ contact.name }}</p>
                                    <p v-if="contact.title" class="text-xs text-muted">{{ contact.title }}</p>
                                    <a
                                        v-if="contact.email"
                                        :href="`mailto:${contact.email}`"
                                        class="text-xs text-primary hover:underline"
                                    >
                                        {{ contact.email }}
                                    </a>
                                    <p v-if="contact.notes" class="text-xs text-dimmed">{{ contact.notes }}</p>
                                </div>
                                <UDropdownMenu
                                    :items="[
                                        {
                                            label: 'Edit',
                                            icon: 'i-lucide-pencil',
                                            onSelect: () => openContactForm({ contact }),
                                        },
                                        {
                                            label: 'Remove',
                                            icon: 'i-lucide-trash-2',
                                            color: 'error',
                                            onSelect: () => removeContact({ contact }),
                                        },
                                    ]"
                                >
                                    <UButton
                                        icon="i-lucide-ellipsis"
                                        color="neutral"
                                        variant="ghost"
                                        size="xs"
                                        aria-label="Contact actions"
                                    />
                                </UDropdownMenu>
                            </li>
                        </ul>
                        <p v-else class="px-4 py-6 text-center text-sm text-muted">No contacts yet.</p>
                    </UCard>
                </div>
            </div>

            <template v-if="funder">
                <PipelineFunderModal v-model:open="isFunderModalOpen" :funder="funder" @saved="reloadFunder" />
                <PipelineEmailDraftModal
                    v-model:open="isEmailDraftOpen"
                    :funder="funder"
                    :opportunity-id="emailDraftOpportunityId"
                />
                <PipelineOpportunityModal
                    v-model:open="isOpportunityModalOpen"
                    :opportunity="editingOpportunity"
                    :funder-id="funder.id"
                    :funder-name="funder.name"
                    @saved="reloadFunder"
                />
                <TasksCreateModal
                    v-model:open="isTaskModalOpen"
                    :funder-id="funder.id"
                    :opportunity-id="funder.opportunities.length === 1 ? funder.opportunities[0]!.id : null"
                    @created="() => refreshTasks()"
                />
                <TasksSlideover v-model:open="isTaskOpen" :task-id="openTaskId" @changed="() => refreshTasks()" />
                <PipelineContactModal
                    v-model:open="isContactModalOpen"
                    :funder-id="funder.id"
                    :contact="editingContact"
                    @saved="reloadFunder"
                />
            </template>
        </template>
    </UDashboardPanel>
</template>
