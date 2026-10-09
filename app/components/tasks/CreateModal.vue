<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useToast } from '#imports'
import type { TaskDetail } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { NO_OWNER, ownerIdFromSelection, usePipelineReference } from '~/composables/usePipelineReference.ts'
import { linkIdFromSelection, NO_LINK, useTaskReference } from '~/composables/useTaskReference.ts'

const props = defineProps<{ milestoneId?: string | null; opportunityId?: string | null; funderId?: string | null }>()
const emit = defineEmits<{ created: [task: TaskDetail] }>()
const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()
const { ownerItems } = usePipelineReference()
const { milestoneItems, opportunityItems } = useTaskReference()

const formState = reactive({
    title: '',
    description: '',
    assignee_id: NO_OWNER,
    due_at: '',
    milestone_id: NO_LINK,
    opportunity_id: NO_LINK,
})
const errorMessage = ref<string | null>(null)
const isSaving = ref(false)

watch(open, isOpen => {
    if (isOpen) {
        Object.assign(formState, {
            title: '',
            description: '',
            assignee_id: NO_OWNER,
            due_at: '',
            milestone_id: props.milestoneId ?? NO_LINK,
            opportunity_id: props.opportunityId ?? NO_LINK,
        })
        errorMessage.value = null
    }
})

/**
 * Create the task and close.
 *
 * @returns Resolves once created, or once the error is shown.
 */
async function createTask() {
    errorMessage.value = null
    isSaving.value = true
    try {
        const task = await api<TaskDetail>({
            path: '/tasks',
            method: 'POST',
            body: {
                title: formState.title,
                description: formState.description.trim() || null,
                assignee_id: ownerIdFromSelection({ ownerId: formState.assignee_id }),
                due_at: formState.due_at || null,
                milestone_id: linkIdFromSelection({ value: formState.milestone_id }),
                opportunity_id: linkIdFromSelection({ value: formState.opportunity_id }),
                funder_id: props.funderId ?? null,
            },
        })
        toast.add({
            title: 'Task added',
            description: task.assignee ? `${task.assignee.name} will get an email.` : undefined,
            color: 'success',
        })
        emit('created', task)
        open.value = false
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error })
    } finally {
        isSaving.value = false
    }
}
</script>

<template>
    <UModal v-model:open="open" title="New task" :ui="{ content: 'max-w-xl' }">
        <template #body>
            <UForm :state="formState" class="space-y-4" @submit="createTask">
                <UFormField label="What needs to happen" name="title" required>
                    <UInput
                        v-model="formState.title"
                        placeholder="Send the concept note to UBS"
                        class="w-full"
                        autofocus
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField label="Assignee" name="assignee_id" help="They'll get an email.">
                        <USelect v-model="formState.assignee_id" :items="ownerItems" class="w-full" />
                    </UFormField>
                    <UFormField label="Deadline" name="due_at">
                        <UInput v-model="formState.due_at" type="date" class="w-full" />
                    </UFormField>
                    <UFormField label="Milestone" name="milestone_id">
                        <USelect v-model="formState.milestone_id" :items="milestoneItems" class="w-full" />
                    </UFormField>
                    <UFormField label="Opportunity" name="opportunity_id">
                        <USelect v-model="formState.opportunity_id" :items="opportunityItems" class="w-full" />
                    </UFormField>
                </div>
                <UFormField label="Details" name="description">
                    <UTextarea v-model="formState.description" :rows="3" autoresize class="w-full" />
                </UFormField>
                <UAlert v-if="errorMessage" color="error" :description="errorMessage" />
                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
                    <UButton type="submit" variant="solid" :loading="isSaving" label="Add task" />
                </div>
            </UForm>
        </template>
    </UModal>
</template>
