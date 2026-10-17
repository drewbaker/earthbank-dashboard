<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSeoMeta, useToast } from '#imports'
import type { ColorMode, User } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { useAuth } from '~/composables/useAuth.ts'
import { useColorModePreference } from '~/composables/useColorModePreference.ts'

useSeoMeta({ title: 'Profile · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()
const { currentUser } = useAuth()
const { colorModeChoice, chooseColorMode } = useColorModePreference()

/** Largest picture the server accepts (keep in step with MAX_AVATAR_BYTES). */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

const avatarInput = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)
const isRemoving = ref(false)

const COLOR_MODE_OPTIONS: { value: ColorMode; label: string; description: string; icon: string }[] = [
    { value: 'light', label: 'Light', description: 'Always light', icon: 'i-lucide-sun' },
    { value: 'dark', label: 'Dark', description: 'Always dark', icon: 'i-lucide-moon' },
    { value: 'system', label: 'Auto', description: 'Match your device', icon: 'i-lucide-monitor' },
]

const pictureSource = computed(() => {
    if (currentUser.value?.has_uploaded_avatar) return 'Your uploaded picture.'
    if (currentUser.value?.avatar_url) return 'Your Google profile picture. Upload one to use a different picture.'
    return 'No picture yet, so your initials are shown. Upload one, or connect Gmail to use your Google picture.'
})

/**
 * Upload the chosen picture and show it everywhere.
 *
 * @param event - The file input's change event.
 * @returns Resolves once uploaded, or once the error is shown.
 */
async function uploadAvatar(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) {
        return
    }
    if (file.size > MAX_AVATAR_BYTES) {
        toast.add({ title: 'Pictures can be up to 2 MB.', color: 'error' })
        return
    }
    const form = new FormData()
    form.append('file', file)
    isUploading.value = true
    try {
        currentUser.value = await api<User>({ path: '/auth/me/avatar', method: 'POST', body: form })
        toast.add({ title: 'Picture updated', color: 'success' })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isUploading.value = false
    }
}

/**
 * Remove the uploaded picture, going back to the Google one (or initials).
 *
 * @returns Resolves once removed, or once the error is shown.
 */
async function removeAvatar() {
    isRemoving.value = true
    try {
        currentUser.value = await api<User>({ path: '/auth/me/avatar', method: 'DELETE' })
        toast.add({ title: 'Picture removed', color: 'success' })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isRemoving.value = false
    }
}
</script>

<template>
    <div v-if="currentUser" class="space-y-8">
        <section class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Profile</h2>
                <p class="text-sm text-muted">How you appear to the rest of the team.</p>
            </div>
            <UCard>
                <div class="flex flex-wrap items-center gap-5">
                    <UAvatar :src="currentUser.avatar_url ?? undefined" :alt="currentUser.name" size="3xl" />
                    <div class="min-w-0 flex-1 space-y-1">
                        <p class="font-medium text-highlighted">{{ currentUser.name }}</p>
                        <p class="text-sm text-muted">{{ currentUser.email }}</p>
                        <p class="text-xs text-dimmed">{{ pictureSource }}</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <input
                            ref="avatarInput"
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp"
                            class="hidden"
                            @change="uploadAvatar"
                        />
                        <UButton
                            icon="i-lucide-upload"
                            :label="currentUser.has_uploaded_avatar ? 'Change picture' : 'Upload picture'"
                            :loading="isUploading"
                            @click="avatarInput?.click()"
                        />
                        <UButton
                            v-if="currentUser.has_uploaded_avatar"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-trash-2"
                            label="Remove"
                            :loading="isRemoving"
                            @click="removeAvatar"
                        />
                    </div>
                </div>
                <p class="mt-4 text-xs text-muted">PNG, JPEG, GIF or WebP, up to 2 MB. A square picture looks best.</p>
            </UCard>
        </section>

        <section class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Appearance</h2>
                <p class="text-sm text-muted">Saved to your account, so it's the same on every device.</p>
            </div>
            <ClientOnly>
                <div class="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
                    <button
                        v-for="option in COLOR_MODE_OPTIONS"
                        :key="option.value"
                        type="button"
                        role="radio"
                        :aria-checked="colorModeChoice === option.value"
                        class="flex items-center gap-3 rounded-md border p-4 text-left transition-colors"
                        :class="
                            colorModeChoice === option.value
                                ? 'border-primary bg-primary/10'
                                : 'border-default hover:bg-elevated/50'
                        "
                        @click="chooseColorMode({ mode: option.value })"
                    >
                        <UIcon :name="option.icon" class="size-5 shrink-0 text-muted" />
                        <span>
                            <span class="block font-medium text-highlighted">{{ option.label }}</span>
                            <span class="block text-xs text-muted">{{ option.description }}</span>
                        </span>
                    </button>
                </div>
                <template #fallback><div class="h-18" /></template>
            </ClientOnly>
        </section>
    </div>
</template>
