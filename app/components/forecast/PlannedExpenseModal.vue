<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, ref, watch } from 'vue'
import type { z } from 'zod'
import type { PlannedExpense } from '#shared/schemas/index.ts'
import { CreatePlannedExpenseRequest } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { centsToDollars, dollarsToCents } from '~/utils/format.ts'

const props = defineProps<{ plannedExpense?: PlannedExpense | null; today: string }>()
const isOpen = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const api = useApi()
const form = reactive({
    label: '',
    kind: 'one_off' as PlannedExpense['kind'],
    amount_dollars: undefined as number | undefined,
    starts_on: '',
    ends_on: '',
    notes: '',
})
const errorMessage = ref<string | null>(null)
const isSaving = ref(false)

// The form state in API shape, validated by the same schema the server uses.
const request = computed(() => ({
    label: form.label,
    kind: form.kind,
    amount_cents: dollarsToCents({ dollars: form.amount_dollars }) ?? 0,
    starts_on: form.starts_on,
    ends_on: form.kind === 'monthly' && form.ends_on ? form.ends_on : null,
    notes: form.notes.trim() || null,
}))

watch(isOpen, open => {
    if (!open) {
        return
    }
    const expense = props.plannedExpense
    errorMessage.value = null
    Object.assign(form, {
        label: expense?.label ?? '',
        kind: expense?.kind ?? 'one_off',
        amount_dollars: centsToDollars({ cents: expense?.amount_cents }) ?? undefined,
        starts_on: expense?.starts_on ?? props.today,
        ends_on: expense?.ends_on ?? '',
        notes: expense?.notes ?? '',
    })
})

/**
 * Create or update the planned expense.
 *
 * `UForm`'s `@submit` callback, so it takes the event shape Nuxt UI gives it.
 *
 * @param event - Submit event with the validated request.
 * @returns Resolves once saved, or once the error is shown.
 */
async function savePlannedExpense(event: FormSubmitEvent<z.output<typeof CreatePlannedExpenseRequest>>) {
    isSaving.value = true
    errorMessage.value = null
    try {
        await api({
            path: props.plannedExpense ? `/planned-expenses/${props.plannedExpense.id}` : '/planned-expenses',
            method: props.plannedExpense ? 'PATCH' : 'POST',
            body: event.data,
        })
        emit('saved')
        isOpen.value = false
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error })
    } finally {
        isSaving.value = false
    }
}
</script>

<template>
    <UModal
        v-model:open="isOpen"
        :title="plannedExpense ? 'Edit planned expense' : 'Plan an expense'"
        description="A spending decision you've made but not paid yet. It's included in the forecast."
    >
        <template #body>
            <UForm
                :schema="CreatePlannedExpenseRequest"
                :state="request"
                class="space-y-4"
                @submit="savePlannedExpense"
            >
                <UFormField label="What is it?" name="label" required>
                    <UInput v-model="form.label" placeholder="Market research study" class="w-full" autofocus />
                </UFormField>
                <UFormField name="kind">
                    <UTabs
                        v-model="form.kind"
                        :items="[
                            { label: 'One-off', value: 'one_off', icon: 'i-lucide-receipt' },
                            { label: 'Monthly', value: 'monthly', icon: 'i-lucide-repeat' },
                        ]"
                        :content="false"
                        size="sm"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField :label="form.kind === 'monthly' ? 'Per month' : 'Amount'" name="amount_cents" required>
                        <MoneyInput v-model="form.amount_dollars" />
                    </UFormField>
                    <UFormField :label="form.kind === 'monthly' ? 'Starts' : 'When'" name="starts_on" required>
                        <UInput v-model="form.starts_on" type="date" class="w-full" />
                    </UFormField>
                </div>
                <UFormField
                    v-if="form.kind === 'monthly'"
                    label="Ends"
                    name="ends_on"
                    help="Leave empty if it carries on."
                >
                    <UInput v-model="form.ends_on" type="date" class="w-full" />
                </UFormField>
                <UFormField label="Notes" name="notes">
                    <UTextarea v-model="form.notes" :rows="2" autoresize class="w-full" />
                </UFormField>
                <UAlert v-if="errorMessage" color="error" icon="i-lucide-circle-alert" :title="errorMessage" />
                <div class="flex justify-end gap-2">
                    <UButton label="Cancel" color="neutral" variant="ghost" @click="isOpen = false" />
                    <UButton
                        type="submit"
                        :label="plannedExpense ? 'Save' : 'Add to forecast'"
                        variant="solid"
                        :loading="isSaving"
                    />
                </div>
            </UForm>
        </template>
    </UModal>
</template>
