<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { computed } from 'vue'
import { useColorMode } from '#imports'
import { useAuth } from '~/composables/useAuth.ts'
import { useColorModePreference } from '~/composables/useColorModePreference.ts'

defineProps<{ collapsed?: boolean }>()

const { currentUser, signOut } = useAuth()
const colorMode = useColorMode()
const { chooseColorMode } = useColorModePreference()

const menuItems = computed<DropdownMenuItem[][]>(() => [
    [{ label: currentUser.value?.email ?? '', type: 'label' }],
    [
        { label: 'Your profile', icon: 'i-lucide-circle-user', to: '/settings/profile' },
        {
            label: colorMode.value === 'dark' ? 'Light mode' : 'Dark mode',
            icon: colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon',
            onSelect: () => chooseColorMode({ mode: colorMode.value === 'dark' ? 'light' : 'dark' }),
        },
    ],
    [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: () => signOut() }],
])
</script>

<template>
    <UDropdownMenu v-if="currentUser" :items="menuItems" :content="{ align: 'center' }" class="w-full">
        <UButton
            color="neutral"
            variant="ghost"
            block
            :square="collapsed"
            :label="collapsed ? undefined : currentUser.name"
            :avatar="{ src: currentUser.avatar_url ?? undefined, alt: currentUser.name }"
            :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
            class="justify-start"
        />
    </UDropdownMenu>
</template>
