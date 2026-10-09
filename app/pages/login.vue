<script setup lang="ts">
import { computed } from 'vue'
import { definePageMeta, useRoute, useSeoMeta } from '#imports'

definePageMeta({ layout: 'auth', public: true })
useSeoMeta({ title: 'Sign in · Earth Bank Dashboard' })

const route = useRoute()

const signInErrors: Record<string, string> = {
    wrong_account: 'Use your @theearthbank.org Google account.',
    deactivated: 'Your access has been turned off. Ask another Earth Bank admin to reactivate you.',
    sign_in_expired: 'That sign-in took too long or was interrupted. Try again.',
    sign_in_cancelled: 'Sign-in was cancelled.',
}

const errorMessage = computed(() => {
    const code = route.query.error
    return typeof code === 'string' ? (signInErrors[code] ?? 'Sign-in failed. Try again.') : null
})

const signInUrl = computed(() => {
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    return `/auth/google?redirect=${encodeURIComponent(redirect)}`
})
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
        </div>
    </UCard>
</template>
