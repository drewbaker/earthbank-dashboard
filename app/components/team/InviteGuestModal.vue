<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive, ref, watch } from 'vue'
import type { z } from 'zod'
import { useToast } from '#imports'
import type { User } from '#shared/schemas/index.ts'
import { InviteUserRequest } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'

const emit = defineEmits<{ invited: [user: User] }>()
const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()
const guest = reactive({ name: '', email: '' })
const errorMessage = ref<string | null>(null)
const isInviting = ref(false)

watch(open, isOpen => {
    if (isOpen) {
        Object.assign(guest, { name: '', email: '' })
        errorMessage.value = null
    }
})

/**
 * Invite the guest, which emails them a sign-in link, then close.
 *
 * `UForm`'s `@submit` callback, so it takes the event shape Nuxt UI gives it.
 *
 * @param event - Submit event carrying the validated name and email.
 * @returns Resolves once invited, or once the error is shown.
 */
async function inviteGuest(event: FormSubmitEvent<z.output<typeof InviteUserRequest>>) {
    errorMessage.value = null
    isInviting.value = true
    try {
        const user = await api<User>({ path: '/users', method: 'POST', body: event.data })
        toast.add({ title: `Invitation sent to ${user.email}`, color: 'success' })
        emit('invited', user)
        open.value = false
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error })
    } finally {
        isInviting.value = false
    }
}
</script>

<template>
    <UModal
        v-model:open="open"
        title="Invite a guest"
        description="For people without an @theearthbank.org account. They get a sign-in link by email."
    >
        <template #body>
            <UForm :schema="InviteUserRequest" :state="guest" class="space-y-4" @submit="inviteGuest">
                <UFormField label="Name" name="name" required>
                    <UInput v-model="guest.name" autofocus class="w-full" />
                </UFormField>
                <UFormField
                    label="Email"
                    name="email"
                    required
                    help="They'll have the same access as everyone on the team."
                >
                    <UInput v-model="guest.email" type="email" placeholder="name@example.org" class="w-full" />
                </UFormField>

                <UAlert v-if="errorMessage" color="error" :description="errorMessage" />

                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
                    <UButton
                        type="submit"
                        variant="solid"
                        icon="i-lucide-send"
                        label="Send invitation"
                        :loading="isInviting"
                    />
                </div>
            </UForm>
        </template>
    </UModal>
</template>
