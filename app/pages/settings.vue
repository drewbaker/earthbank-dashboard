<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

// Settings sections; each child page renders only its body.
const settingsSections: NavigationMenuItem[] = [
    { label: 'Team', icon: 'i-lucide-users', to: '/settings/team' },
    { label: 'Pipeline', icon: 'i-lucide-target', to: '/settings/pipeline' },
    { label: 'Cash', icon: 'i-lucide-landmark', to: '/settings/cash' },
    { label: 'Email', icon: 'i-lucide-mail', to: '/settings/email' },
]
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Settings">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
            <UDashboardToolbar>
                <UNavigationMenu :items="settingsSections" highlight class="-mx-1 flex-1" />
            </UDashboardToolbar>
        </template>

        <template #body>
            <div class="mx-auto w-full max-w-4xl">
                <NuxtPage />
            </div>
        </template>
    </UDashboardPanel>
</template>
