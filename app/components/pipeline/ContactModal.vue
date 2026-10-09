<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useToast } from '#imports'
import type { Contact } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'

const props = defineProps<{ funderId: string; contact?: Contact | null }>()
const emit = defineEmits<{ saved: [contact: Contact] }>()
const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()
const formState = reactive({ name: '', title: '', email: '', notes: '' })
const errorMessage = ref<string | null>(null)
const isSaving = ref(false)
const isEditing = computed(() => Boolean(props.contact))

watch(open, isOpen => {
    if (isOpen) {
        formState.name = props.contact?.name ?? ''
        formState.title = props.contact?.title ?? ''
        formState.email = props.contact?.email ?? ''
        formState.notes = props.contact?.notes ?? ''
        errorMessage.value = null
    }
})

/**
 * Save the contact (create or update) and close.
 *
 * @returns Resolves once saved, or once the error is shown.
 */
async function saveContact() {
    errorMessage.value = null
    isSaving.value = true
    const fields = {
        name: formState.name,
        title: formState.title.trim() || null,
        email: formState.email.trim() || null,
        notes: formState.notes.trim() || null,
    }
    try {
        const saved = props.contact
            ? await api<Contact>({ path: `/contacts/${props.contact.id}`, method: 'PATCH', body: fields })
            : await api<Contact>({ path: `/funders/${props.funderId}/contacts`, method: 'POST', body: fields })
        toast.add({ title: isEditing.value ? 'Contact updated' : 'Contact added', color: 'success' })
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
    <UModal v-model:open="open" :title="isEditing ? 'Edit contact' : 'Add contact'">
        <template #body>
            <UForm :state="formState" class="space-y-4" @submit="saveContact">
                <UFormField label="Name" name="name" required>
                    <UInput v-model="formState.name" class="w-full" autofocus />
                </UFormField>
                <UFormField label="Email" name="email" help="Their mail will be matched to this funder.">
                    <UInput v-model="formState.email" type="email" class="w-full" />
                </UFormField>
                <UFormField label="Title" name="title">
                    <UInput v-model="formState.title" class="w-full" />
                </UFormField>
                <UFormField label="Notes" name="notes">
                    <UTextarea v-model="formState.notes" :rows="2" autoresize class="w-full" />
                </UFormField>
                <UAlert v-if="errorMessage" color="error" :description="errorMessage" />
                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
                    <UButton
                        type="submit"
                        variant="solid"
                        :loading="isSaving"
                        :label="isEditing ? 'Save' : 'Add contact'"
                    />
                </div>
            </UForm>
        </template>
    </UModal>
</template>
