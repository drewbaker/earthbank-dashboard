<script setup lang="ts">
import { primaryNavigation, secondaryNavigation } from '~/utils/navigation.ts'
</script>

<template>
    <UDashboardGroup>
        <UDashboardSidebar
            collapsible
            resizable
            :default-size="17"
            :min-size="14"
            :max-size="24"
            :ui="{ footer: 'border-t border-default' }"
        >
            <template #header="{ collapsed }">
                <NuxtLink to="/" class="flex items-center gap-2 px-1">
                    <img src="/favicon.svg" alt="" class="size-6 shrink-0" />
                    <span v-if="!collapsed" class="font-semibold text-highlighted">Earth Bank</span>
                </NuxtLink>
            </template>

            <template #default="{ collapsed }">
                <UNavigationMenu :collapsed="collapsed" :items="primaryNavigation" orientation="vertical" />
                <UNavigationMenu
                    :collapsed="collapsed"
                    :items="secondaryNavigation"
                    orientation="vertical"
                    class="mt-auto"
                />
            </template>

            <template #footer="{ collapsed }">
                <SidebarUserMenu :collapsed="collapsed" />
            </template>
        </UDashboardSidebar>

        <slot />
    </UDashboardGroup>
</template>
