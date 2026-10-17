<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, ref } from 'vue'
import type { z } from 'zod'
import { definePageMeta, useRoute, useSeoMeta } from '#imports'
import { RequestSignInLinkRequest } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'

definePageMeta({ layout: 'auth', public: true })
useSeoMeta({ title: 'Sign in · Earth Bank Dashboard' })

const route = useRoute()
const api = useApi()

const signInErrors: Record<string, string> = {
    wrong_account: 'Use your @theearthbank.org Google account. Invited guests: use your email below.',
    deactivated: 'Your access has been turned off. Ask another Earth Bank admin to reactivate you.',
    sign_in_expired: 'That sign-in took too long or was interrupted. Try again.',
    sign_in_cancelled: 'Sign-in was cancelled.',
}

const errorMessage = computed(() => {
    const code = route.query.error
    return typeof code === 'string' ? (signInErrors[code] ?? 'Sign-in failed. Try again.') : null
})

const redirectPath = computed(() => (typeof route.query.redirect === 'string' ? route.query.redirect : '/'))
const signInUrl = computed(() => `/auth/google?redirect=${encodeURIComponent(redirectPath.value)}`)

// Invited guests outside the Workspace sign in with a link emailed to them.
const guest = reactive({ email: typeof route.query.email === 'string' ? route.query.email : '' })
const isGuestFormOpen = ref(Boolean(route.query.email))
const isSendingLink = ref(false)
const sentToEmail = ref<string | null>(null)
const guestErrorMessage = ref<string | null>(null)

/**
 * Ask for a sign-in link for an invited guest's address.
 *
 * `UForm`'s `@submit` callback, so it takes the event shape Nuxt UI gives it.
 *
 * @param event - Submit event carrying the validated email.
 * @returns Resolves once the link is on its way, or the error is shown.
 */
async function requestSignInLink(event: FormSubmitEvent<z.output<typeof RequestSignInLinkRequest>>) {
    guestErrorMessage.value = null
    isSendingLink.value = true
    try {
        await api({
            path: '/auth/sign-in-links',
            method: 'POST',
            body: { email: event.data.email, redirect: redirectPath.value },
        })
        sentToEmail.value = event.data.email
    } catch (error) {
        guestErrorMessage.value = apiErrorMessage({ error })
    } finally {
        isSendingLink.value = false
    }
}
</script>

<template>
    <UCard class="w-full max-w-sm">
        <div class="flex flex-col items-center gap-6 py-4 text-center">
            <img src="/favicon.svg" alt="" class="size-12" />
            <div class="space-y-1">
                <h1 class="text-xl font-semibold text-highlighted">Earth Bank Dashboard</h1>
                <p class="text-sm text-muted">Sign in with your Earth Bank Google account.</p>
            </div>

            <UAlert v-if="errorMessage" color="error" icon="i-lucide-circle-alert" :description="errorMessage" />

            <UButton
                :to="signInUrl"
                external
                size="lg"
                color="neutral"
                variant="outline"
                icon="i-lucide-log-in"
                label="Sign in with Google"
                block
            />

            <USeparator label="Invited guest?" />

            <UAlert
                v-if="sentToEmail"
                color="success"
                icon="i-lucide-mail-check"
                title="Check your email"
                :description="`If ${sentToEmail} has been invited, a sign-in link is on its way. It works once, for 30 minutes.`"
            />
            <UButton
                v-else-if="!isGuestFormOpen"
                color="neutral"
                variant="ghost"
                icon="i-lucide-mail"
                label="Email me a sign-in link"
                block
                @click="isGuestFormOpen = true"
            />
            <UForm
                v-else
                :schema="RequestSignInLinkRequest"
                :state="guest"
                class="w-full space-y-3 text-left"
                @submit="requestSignInLink"
            >
                <UFormField label="Your email" name="email">
                    <UInput
                        v-model="guest.email"
                        type="email"
                        autocomplete="email"
                        placeholder="you@example.org"
                        autofocus
                        class="w-full"
                    />
                </UFormField>
                <UAlert v-if="guestErrorMessage" color="error" :description="guestErrorMessage" />
                <UButton type="submit" label="Email me a link" variant="solid" :loading="isSendingLink" block />
            </UForm>
        </div>
    </UCard>
</template>
