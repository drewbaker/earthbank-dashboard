<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { z } from 'zod'
import { CreateFundRequest } from '#shared/schemas/index.ts'
import type { FundDetail } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'

const emit = defineEmits<{ saved: [fund: FundDetail] }>()
const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const formState = reactive({ name: '', website_url: '', linkedin_url: '' })
const errorMessage = ref<string | null>(null)
const isSaving = ref(false)

watch(open, isOpen => {
    if (isOpen) {
        formState.name = ''
        formState.website_url = ''
        formState.linkedin_url = ''
        errorMessage.value = null
    }
})

/**
 * Add the fund and queue its research.
 *
 * `UForm`'s `@submit` callback, so it takes the event shape Nuxt UI gives it.
 *
 * @param event - Submit event with the validated form data.
 * @returns Resolves once saved, or once the error is shown.
 */
async function saveFund(event: FormSubmitEvent<z.output<typeof CreateFundRequest>>) {
    errorMessage.value = null
    isSaving.value = true
    try {
        const fund = await api<FundDetail>({
            path: '/funds',
            method: 'POST',
            body: {
                name: event.data.name,
                website_url: event.data.website_url,
                linkedin_url: event.data.linkedin_url || null,
            },
        })
        open.value = false
        emit('saved', fund)
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error })
    } finally {
        isSaving.value = false
    }
}
</script>

<template>
    <UModal
        v-model:open="open"
        title="Add a fund"
        description="The research assistant will look it up from public sources."
    >
        <template #body>
            <UForm :schema="CreateFundRequest" :state="formState" class="space-y-4" @submit="saveFund">
                <UFormField label="Name" name="name" required>
                    <UInput v-model="formState.name" placeholder="Iungo Capital" class="w-full" autofocus />
                </UFormField>
                <UFormField label="Website" name="website_url" required>
                    <UInput v-model="formState.website_url" placeholder="https://iungocapital.com" class="w-full" />
                </UFormField>
                <UFormField label="LinkedIn page" name="linkedin_url" hint="Optional">
                    <UInput
                        v-model="formState.linkedin_url"
                        placeholder="https://www.linkedin.com/company/…"
                        class="w-full"
                    />
                </UFormField>
                <UAlert v-if="errorMessage" color="error" variant="subtle" :description="errorMessage" />
                <div class="flex justify-end gap-2">
                    <UButton label="Cancel" color="neutral" variant="ghost" @click="open = false" />
                    <UButton type="submit" label="Add and research" variant="solid" :loading="isSaving" />
                </div>
            </UForm>
        </template>
    </UModal>
</template>
