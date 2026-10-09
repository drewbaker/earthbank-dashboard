<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useToast } from '#imports'
import { TASK_STATUS_DETAILS, TASK_STATUSES } from '#shared/constants/pipeline.ts'
import type { Attachment, Comment, TaskDetail } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { useAuth } from '~/composables/useAuth.ts'
import { NO_OWNER, ownerIdFromSelection, usePipelineReference } from '~/composables/usePipelineReference.ts'
import { linkIdFromSelection, NO_LINK, useTaskReference } from '~/composables/useTaskReference.ts'
import { formatRelativeTime } from '~/utils/format.ts'

const props = defineProps<{ taskId: string | null }>()
const emit = defineEmits<{ changed: [] }>()
const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()
const { currentUser } = useAuth()
const { ownerItems } = usePipelineReference()
const { milestoneItems, opportunityItems } = useTaskReference()

const task = ref<TaskDetail | null>(null)
const isLoading = ref(false)
const isSavingField = ref(false)
const newComment = ref('')
const isPostingComment = ref(false)
const isUploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// Editable copy of the task; each field saves on its own when it changes or loses focus.
const draft = reactive({
    title: '',
    description: '',
    status: 'todo' as TaskDetail['status'],
    assignee_id: NO_OWNER,
    due_at: '',
    milestone_id: NO_LINK,
    opportunity_id: NO_LINK,
})

const statusItems = TASK_STATUSES.map(status => ({
    label: TASK_STATUS_DETAILS[status].label,
    value: status,
    icon: TASK_STATUS_DETAILS[status].icon,
}))

const funderLink = computed(() => task.value?.opportunity?.funder ?? task.value?.funder ?? null)

watch(
    () => [open.value, props.taskId] as const,
    async ([isOpen, taskId]) => {
        if (isOpen && taskId) {
            await loadTask({ taskId })
        }
    },
    { immediate: true },
)

/**
 * Load the task and copy it into the editable draft.
 *
 * @param input.taskId - The task.
 * @returns Resolves once loaded.
 */
async function loadTask({ taskId }: { taskId: string }) {
    isLoading.value = true
    try {
        setTask({ loaded: await api<TaskDetail>({ path: `/tasks/${taskId}` }) })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error, fallback: 'Could not load the task.' }), color: 'error' })
        open.value = false
    } finally {
        isLoading.value = false
    }
}

/**
 * Store a freshly loaded task and reset the draft to match.
 *
 * @param input.loaded - The task from the API.
 * @returns Nothing.
 */
function setTask({ loaded }: { loaded: TaskDetail }) {
    task.value = loaded
    Object.assign(draft, {
        title: loaded.title,
        description: loaded.description ?? '',
        status: loaded.status,
        assignee_id: loaded.assignee?.id ?? NO_OWNER,
        due_at: loaded.due_at ?? '',
        milestone_id: loaded.milestone?.id ?? NO_LINK,
        opportunity_id: loaded.opportunity?.id ?? NO_LINK,
    })
}

/**
 * Save one field if it changed.
 *
 * @param input.field - The draft field that changed.
 * @returns Resolves once saved.
 */
async function saveField({ field }: { field: keyof typeof draft }) {
    if (!task.value) {
        return
    }
    const body: Record<string, unknown> = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        status: draft.status,
        assignee_id: ownerIdFromSelection({ ownerId: draft.assignee_id }),
        due_at: draft.due_at || null,
        milestone_id: linkIdFromSelection({ value: draft.milestone_id }),
        opportunity_id: linkIdFromSelection({ value: draft.opportunity_id }),
    }
    const current: Record<string, unknown> = {
        title: task.value.title,
        description: task.value.description,
        status: task.value.status,
        assignee_id: task.value.assignee?.id ?? null,
        due_at: task.value.due_at,
        milestone_id: task.value.milestone?.id ?? null,
        opportunity_id: task.value.opportunity?.id ?? null,
    }
    if (body[field] === current[field] || (field === 'title' && !body.title)) {
        return
    }
    isSavingField.value = true
    try {
        setTask({
            loaded: await api<TaskDetail>({
                path: `/tasks/${task.value.id}`,
                method: 'PATCH',
                body: { [field]: body[field] },
            }),
        })
        if (field === 'assignee_id' && task.value.assignee && task.value.assignee.id !== currentUser.value?.id) {
            toast.add({
                title: `Assigned to ${task.value.assignee.name}`,
                description: 'They will get an email.',
                color: 'success',
            })
        }
        emit('changed')
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isSavingField.value = false
    }
}

/**
 * Post the comment in the composer.
 *
 * @returns Resolves once posted and the task reloaded.
 */
async function postComment() {
    if (!task.value || !newComment.value.trim()) {
        return
    }
    isPostingComment.value = true
    try {
        await api<Comment>({
            path: `/tasks/${task.value.id}/comments`,
            method: 'POST',
            body: { body: newComment.value },
        })
        newComment.value = ''
        await loadTask({ taskId: task.value.id })
        emit('changed')
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isPostingComment.value = false
    }
}

/**
 * Delete one of your own comments.
 *
 * @param input.comment - The comment.
 * @returns Resolves once deleted and reloaded.
 */
async function deleteComment({ comment }: { comment: Comment }) {
    try {
        await api({ path: `/comments/${comment.id}`, method: 'DELETE' })
        await loadTask({ taskId: task.value!.id })
        emit('changed')
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    }
}

/**
 * Upload the files chosen in the file picker.
 *
 * @param event - The file input's change event.
 * @returns Resolves once every file is uploaded.
 */
async function uploadFiles(event: Event) {
    const files = [...((event.target as HTMLInputElement).files ?? [])]
    if (!task.value || files.length === 0) {
        return
    }
    isUploading.value = true
    try {
        for (const file of files) {
            const form = new FormData()
            form.append('file', file)
            // FormData can't go through the JSON helper; $fetch sends it as multipart.
            await $fetch(`/v1/tasks/${task.value.id}/attachments`, { method: 'POST', body: form })
        }
        await loadTask({ taskId: task.value.id })
        emit('changed')
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error, fallback: 'Upload failed.' }), color: 'error' })
    } finally {
        isUploading.value = false
        if (fileInput.value) {
            fileInput.value.value = ''
        }
    }
}

/**
 * Remove an attachment.
 *
 * @param input.attachment - The attachment.
 * @returns Resolves once removed and reloaded.
 */
async function removeAttachment({ attachment }: { attachment: Attachment }) {
    try {
        await api({ path: `/attachments/${attachment.id}`, method: 'DELETE' })
        await loadTask({ taskId: task.value!.id })
        emit('changed')
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    }
}

/**
 * Delete the task and close.
 *
 * @returns Resolves once deleted.
 */
async function deleteTask() {
    try {
        await api({ path: `/tasks/${task.value!.id}`, method: 'DELETE' })
        toast.add({ title: 'Task deleted', color: 'success' })
        open.value = false
        emit('changed')
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    }
}

/**
 * Human-readable file size.
 *
 * @param input.bytes - Size in bytes.
 * @returns e.g. "240 KB".
 */
function formatFileSize({ bytes }: { bytes: number }) {
    return bytes < 1024 * 1024
        ? `${Math.max(1, Math.round(bytes / 1024))} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
    <USlideover v-model:open="open" :title="task?.title ?? 'Task'" :ui="{ content: 'max-w-xl' }">
        <template #body>
            <div v-if="isLoading && !task" class="space-y-3">
                <USkeleton class="h-8 w-2/3" />
                <USkeleton class="h-24 w-full" />
            </div>

            <div v-else-if="task" class="space-y-6">
                <UInput
                    v-model="draft.title"
                    variant="ghost"
                    size="xl"
                    class="w-full font-semibold"
                    aria-label="Task title"
                    @blur="saveField({ field: 'title' })"
                />

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField label="Status">
                        <USelect
                            v-model="draft.status"
                            :items="statusItems"
                            class="w-full"
                            @update:model-value="saveField({ field: 'status' })"
                        />
                    </UFormField>
                    <UFormField label="Assignee">
                        <USelect
                            v-model="draft.assignee_id"
                            :items="ownerItems"
                            class="w-full"
                            @update:model-value="saveField({ field: 'assignee_id' })"
                        />
                    </UFormField>
                    <UFormField label="Deadline">
                        <UInput
                            v-model="draft.due_at"
                            type="date"
                            class="w-full"
                            @change="saveField({ field: 'due_at' })"
                        />
                    </UFormField>
                    <UFormField label="Milestone">
                        <USelect
                            v-model="draft.milestone_id"
                            :items="milestoneItems"
                            class="w-full"
                            @update:model-value="saveField({ field: 'milestone_id' })"
                        />
                    </UFormField>
                    <UFormField label="Opportunity" class="sm:col-span-2">
                        <USelect
                            v-model="draft.opportunity_id"
                            :items="opportunityItems"
                            class="w-full"
                            @update:model-value="saveField({ field: 'opportunity_id' })"
                        />
                    </UFormField>
                </div>

                <UButton
                    v-if="funderLink"
                    :to="`/pipeline/funders/${funderLink.id}`"
                    :label="`Open ${funderLink.name}`"
                    icon="i-lucide-building-2"
                    color="neutral"
                    variant="link"
                    class="px-0"
                />

                <UFormField label="Details">
                    <UTextarea
                        v-model="draft.description"
                        :rows="3"
                        autoresize
                        placeholder="Add context, links, what done looks like…"
                        class="w-full"
                        @blur="saveField({ field: 'description' })"
                    />
                </UFormField>

                <section class="space-y-2">
                    <div class="flex items-center justify-between">
                        <h3 class="text-sm font-medium text-highlighted">Files</h3>
                        <UButton
                            size="xs"
                            icon="i-lucide-paperclip"
                            label="Attach"
                            :loading="isUploading"
                            @click="fileInput?.click()"
                        />
                        <input ref="fileInput" type="file" multiple class="hidden" @change="uploadFiles" />
                    </div>
                    <ul v-if="task.attachments.length" class="divide-y divide-default rounded-md border border-default">
                        <li
                            v-for="attachment in task.attachments"
                            :key="attachment.id"
                            class="flex items-center gap-3 px-3 py-2"
                        >
                            <UIcon name="i-lucide-file" class="size-4 text-muted" />
                            <a
                                :href="attachment.download_url"
                                class="min-w-0 flex-1 truncate text-sm text-primary hover:underline"
                            >
                                {{ attachment.filename }}
                            </a>
                            <span class="text-xs text-muted">{{
                                formatFileSize({ bytes: attachment.size_bytes })
                            }}</span>
                            <UButton
                                icon="i-lucide-x"
                                size="xs"
                                color="neutral"
                                variant="ghost"
                                aria-label="Remove file"
                                @click="removeAttachment({ attachment })"
                            />
                        </li>
                    </ul>
                </section>

                <section class="space-y-3">
                    <h3 class="text-sm font-medium text-highlighted">Comments</h3>
                    <ul class="space-y-3">
                        <li v-for="comment in task.comments" :key="comment.id" class="flex gap-3">
                            <UAvatar
                                :src="comment.author?.avatar_url ?? undefined"
                                :alt="comment.author?.name ?? '?'"
                                size="xs"
                            />
                            <div class="min-w-0 flex-1">
                                <p class="text-xs text-muted">
                                    <span class="font-medium text-highlighted">{{
                                        comment.author?.name ?? 'Former member'
                                    }}</span>
                                    · {{ formatRelativeTime({ value: comment.created_at }) }}
                                    <template v-if="comment.edited_at"> · edited</template>
                                    <UButton
                                        v-if="comment.author?.id === currentUser?.id"
                                        label="Delete"
                                        size="xs"
                                        color="neutral"
                                        variant="link"
                                        class="p-0 pl-1"
                                        @click="deleteComment({ comment })"
                                    />
                                </p>
                                <p class="text-sm whitespace-pre-line">{{ comment.body }}</p>
                            </div>
                        </li>
                    </ul>
                    <UForm :state="{ newComment }" class="space-y-2" @submit="postComment">
                        <UTextarea
                            v-model="newComment"
                            :rows="2"
                            autoresize
                            placeholder="Write a comment. The assignee and earlier commenters get an email."
                            class="w-full"
                            @keydown.meta.enter="postComment"
                            @keydown.ctrl.enter="postComment"
                        />
                        <div class="flex justify-end">
                            <UButton
                                type="submit"
                                size="sm"
                                label="Comment"
                                :loading="isPostingComment"
                                :disabled="!newComment.trim()"
                            />
                        </div>
                    </UForm>
                </section>
            </div>
        </template>

        <template #footer>
            <div v-if="task" class="flex w-full items-center justify-between text-xs text-muted">
                <span>
                    Created {{ formatRelativeTime({ value: task.created_at }) }}
                    <template v-if="task.created_by"> by {{ task.created_by.name }}</template>
                </span>
                <UButton
                    label="Delete task"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    @click="deleteTask"
                />
            </div>
        </template>
    </USlideover>
</template>
