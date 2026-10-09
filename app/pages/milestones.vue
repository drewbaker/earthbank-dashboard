<script setup lang="ts">
import { useSeoMeta } from '#imports'

useSeoMeta({ title: 'Milestones & Tasks · Earth Bank Dashboard' })
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Milestones & Tasks">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UpcomingFeatureNotice
                title="Milestones & Tasks"
                description="What each person needs to do, and by when, for every funding milestone."
                :phase="3"
            />
        </template>
    </UDashboardPanel>
</template>
