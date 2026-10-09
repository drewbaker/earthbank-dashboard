<script setup lang="ts">
import { useSeoMeta } from '#imports'

useSeoMeta({ title: 'Pipeline · Earth Bank Dashboard' })
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Pipeline">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UpcomingFeatureNotice
                title="Pipeline"
                description="Every funder and opportunity, by goal and stage."
                :phase="2"
            />
        </template>
    </UDashboardPanel>
</template>
