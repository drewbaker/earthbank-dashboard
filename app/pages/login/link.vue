<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { definePageMeta, useSeoMeta } from '#imports'
import type { SignInLinkRedeemed } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'

definePageMeta({ layout: 'auth', public: true })
useSeoMeta({ title: 'Sign in · Earth Bank Dashboard' })

const api = useApi()

// The token rides in the URL fragment, which only the browser sees, so it's read after mounting.
// Signing in waits for a click: mail scanners open links on their own, and must not use one up.
const token = ref<string | null>(null)
const redirectPath = ref<string | undefined>(undefined)
const isSigningIn = ref(false)
const errorMessage = ref<string | null>(null)

onMounted(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    token.value = fragment.get('token')
    redirectPath.value = fragment.get('redirect') ?? undefined
})

/**
 * Use the link to start a session, then open the dashboard.
 *
 * @returns Resolves once the browser is on its way, or the error is shown.
 */
async function signIn() {
    if (!token.value) {
        return
    }
    errorMessage.value = null
    isSigningIn.value = true
    try {
        const result = await api<SignInLinkRedeemed>({
            path: '/auth/sign-in-links/redeem',
            method: 'POST',
            body: { token: token.value, redirect: redirectPath.value },
        })
        // A full page load, so the app starts fresh with the new session.
        window.location.assign(result.redirect)
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error })
        isSigningIn.value = false
    }
}
</script>

<template>
    <UCard class="w-full max-w-sm">
        <div class="flex flex-col items-center gap-6 py-4 text-center">
            <img src="/favicon.svg" alt="" class="size-12" />
            <div class="space-y-1">
                <h1 class="text-xl font-semibold text-highlighted">Earth Bank Dashboard</h1>
                <p class="text-sm text-muted">Welcome. Use the button to finish signing in.</p>
            </div>

            <ClientOnly>
                <UAlert
                    v-if="!token"
                    color="warning"
                    icon="i-lucide-link-2-off"
                    description="This link is incomplete. Open it straight from your email, or ask for a new one."
                />
                <UButton
                    v-else
                    size="lg"
                    variant="solid"
                    icon="i-lucide-log-in"
                    label="Sign in"
                    :loading="isSigningIn"
                    block
                    @click="signIn"
                />
            </ClientOnly>

            <UAlert v-if="errorMessage" color="error" icon="i-lucide-circle-alert" :description="errorMessage" />

            <UButton to="/login" color="neutral" variant="link" label="Get a new sign-in link" />
        </div>
    </UCard>
</template>
