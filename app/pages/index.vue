<script setup lang="ts">
import { useSeoMeta } from '#imports'

useSeoMeta({ title: 'Overview · Earth Bank Dashboard' })
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Overview">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UpcomingFeatureNotice
                title="Overview"
                description="Cash, monthly burn, runway and progress on each funding goal."
                :phase="4"
            />
        </template>
    </UDashboardPanel>
</template>
