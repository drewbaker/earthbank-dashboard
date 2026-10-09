<script setup lang="ts">
import { useSeoMeta } from '#imports'

useSeoMeta({ title: 'Activity · Earth Bank Dashboard' })
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Activity">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UpcomingFeatureNotice
                title="Activity"
                description="Every change to the pipeline, including AI updates from email, with evidence and overrides."
                :phase="5"
            />
        </template>
    </UDashboardPanel>
</template>
