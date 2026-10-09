<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useToast } from '#imports'
import type { GoalType, MilestoneKind, MilestoneStatus } from '#shared/constants/pipeline.ts'
import { GOAL_TYPE_DETAILS, GOAL_TYPES, MILESTONE_KIND_DETAILS, MILESTONE_KINDS } from '#shared/constants/pipeline.ts'
import type { Milestone } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { linkIdFromSelection, NO_LINK, useTaskReference } from '~/composables/useTaskReference.ts'

const props = defineProps<{ milestone?: Milestone | null; opportunityId?: string | null }>()
const emit = defineEmits<{ saved: [milestone: Milestone] }>()
const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()
const { opportunityItems } = useTaskReference()

const formState = reactive({
    title: '',
    description: '',
    due_at: '',
    kind: 'funding' as MilestoneKind,
    status: 'open' as MilestoneStatus,
    goal_type: NO_LINK as GoalType | typeof NO_LINK,
    opportunity_id: NO_LINK,
})
const errorMessage = ref<string | null>(null)
const isSaving = ref(false)
const isEditing = computed(() => Boolean(props.milestone))

const kindItems = MILESTONE_KINDS.map(kind => ({
    label: MILESTONE_KIND_DETAILS[kind].label,
    value: kind,
    icon: MILESTONE_KIND_DETAILS[kind].icon,
}))
const goalItems = [
    { label: 'No goal', value: NO_LINK },
    ...GOAL_TYPES.map(type => ({ label: GOAL_TYPE_DETAILS[type].label, value: type })),
]
const statusItems = [
    { label: 'Open', value: 'open' },
    { label: 'Done', value: 'done' },
]

watch(open, isOpen => {
    if (!isOpen) {
        return
    }
    const milestone = props.milestone
    Object.assign(formState, {
        title: milestone?.title ?? '',
        description: milestone?.description ?? '',
        due_at: milestone?.due_at ?? '',
        kind: milestone?.kind ?? 'funding',
        status: milestone?.status ?? 'open',
        goal_type: milestone?.goal_type ?? NO_LINK,
        opportunity_id: milestone?.opportunity?.id ?? props.opportunityId ?? NO_LINK,
    })
    errorMessage.value = null
})

/**
 * Save the milestone (create or update) and close.
 *
 * @returns Resolves once saved, or once the error is shown.
 */
async function saveMilestone() {
    errorMessage.value = null
    isSaving.value = true
    const fields = {
        title: formState.title,
        description: formState.description.trim() || null,
        due_at: formState.due_at,
        kind: formState.kind,
        goal_type: formState.goal_type === NO_LINK ? null : formState.goal_type,
        opportunity_id: linkIdFromSelection({ value: formState.opportunity_id }),
    }
    try {
        const saved = props.milestone
            ? await api<Milestone>({
                  path: `/milestones/${props.milestone.id}`,
                  method: 'PATCH',
                  body: { ...fields, status: formState.status },
              })
            : await api<Milestone>({ path: '/milestones', method: 'POST', body: fields })
        toast.add({ title: isEditing.value ? 'Milestone updated' : 'Milestone added', color: 'success' })
        emit('saved', saved)
        open.value = false
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error })
    } finally {
        isSaving.value = false
    }
}
</script>

<template>
    <UModal v-model:open="open" :title="isEditing ? 'Edit milestone' : 'New milestone'" :ui="{ content: 'max-w-xl' }">
        <template #body>
            <UForm :state="formState" class="space-y-4" @submit="saveMilestone">
                <UFormField label="Milestone" name="title" required>
                    <UInput
                        v-model="formState.title"
                        placeholder="UBS Optimus grant decision"
                        class="w-full"
                        autofocus
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField label="Date" name="due_at" required>
                        <UInput v-model="formState.due_at" type="date" class="w-full" />
                    </UFormField>
                    <UFormField label="Kind" name="kind">
                        <USelect v-model="formState.kind" :items="kindItems" class="w-full" />
                    </UFormField>
                    <UFormField label="Goal" name="goal_type">
                        <USelect v-model="formState.goal_type" :items="goalItems" class="w-full" />
                    </UFormField>
                    <UFormField label="Opportunity" name="opportunity_id">
                        <USelect v-model="formState.opportunity_id" :items="opportunityItems" class="w-full" />
                    </UFormField>
                    <UFormField v-if="isEditing" label="Status" name="status">
                        <USelect v-model="formState.status" :items="statusItems" class="w-full" />
                    </UFormField>
                </div>
                <UFormField label="Details" name="description">
                    <UTextarea v-model="formState.description" :rows="2" autoresize class="w-full" />
                </UFormField>
                <UAlert v-if="errorMessage" color="error" :description="errorMessage" />
                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
                    <UButton
                        type="submit"
                        variant="solid"
                        :loading="isSaving"
                        :label="isEditing ? 'Save' : 'Add milestone'"
                    />
                </div>
            </UForm>
        </template>
    </UModal>
</template>
