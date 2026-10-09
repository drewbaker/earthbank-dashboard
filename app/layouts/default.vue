<script setup lang="ts">
import { computed } from 'vue'
import { useAsyncData } from '#imports'
import type { ActivitySummary } from '#shared/schemas/index.ts'
import { useApi } from '~/composables/useApi.ts'
import { primaryNavigation, secondaryNavigation } from '~/utils/navigation.ts'

const api = useApi()
// Shows how many AI suggestions and drafted funders wait for review next to "Activity".
const { data: activitySummary } = useAsyncData('layout.activity-summary', () =>
    api<ActivitySummary>({ path: '/activity/summary' }).catch(() => null),
)

const navigationItems = computed(() => {
    const waiting = (activitySummary.value?.pending_changes ?? 0) + (activitySummary.value?.draft_funders ?? 0)
    return primaryNavigation.map(item =>
        item.to === '/activity' && waiting > 0
            ? { ...item, badge: { label: String(waiting), color: 'warning' as const } }
            : item,
    )
})
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
                <UNavigationMenu :collapsed="collapsed" :items="navigationItems" orientation="vertical" />
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
