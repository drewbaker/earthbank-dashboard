<script setup lang="ts">
import { useSeoMeta } from '#imports'

useSeoMeta({ title: 'Forecast · Earth Bank Dashboard' })
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Forecast">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UpcomingFeatureNotice
                title="Forecast"
                description="When OpEx runs out at current burn, and what-if scenarios."
                :phase="4"
            />
        </template>
    </UDashboardPanel>
</template>
