<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAsyncData, useRoute, useRouter, useSeoMeta } from '#imports'
import type { GoalType } from '#shared/constants/pipeline.ts'
import type { OpportunityList } from '#shared/schemas/index.ts'
import { useApi } from '~/composables/useApi.ts'

useSeoMeta({ title: 'Reports · Earth Bank Dashboard' })

const api = useApi()
const route = useRoute()
const router = useRouter()

// Same split as the Pipeline page: grants (months) and lending capital (years).
type ReportTrack = 'grants' | 'lending'
const TRACK_GOAL_TYPES: Record<ReportTrack, GoalType[]> = {
    grants: ['design_grant', 'opex'],
    lending: ['lending_capital'],
}
const track = ref<ReportTrack>(route.query.track === 'lending' ? 'lending' : 'grants')
watch(track, value => router.replace({ query: { track: value === 'grants' ? undefined : value } }))

const { data: opportunityList } = await useAsyncData('reports.opportunities', () =>
    api<OpportunityList>({ path: '/opportunities', query: { include_closed: true, limit: 500 } }),
)

const trackOpportunities = computed(() =>
    (opportunityList.value?.data ?? []).filter(opportunity =>
        TRACK_GOAL_TYPES[track.value].includes(opportunity.goal_type),
    ),
)
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Reports">
                <template #leading>
                    <UDashboardSidebarCollapse />
                </template>
            </UDashboardNavbar>
            <UDashboardToolbar>
                <UTabs
                    v-model="track"
                    :items="[
                        { label: 'Design Grants', value: 'grants', icon: 'i-lucide-pencil-ruler' },
                        { label: 'Lending Capital', value: 'lending', icon: 'i-lucide-landmark' },
                    ]"
                    :content="false"
                    variant="link"
                    class="-mb-px"
                />
            </UDashboardToolbar>
        </template>

        <template #body>
            <div class="space-y-6">
                <ReportsStatusOverview :opportunities="trackOpportunities" />

                <UCard v-if="track === 'lending'">
                    <template #header>
                        <h2 class="font-medium text-highlighted">Lending capital over time</h2>
                        <p class="text-xs text-muted">
                            Raised so far plus what's expected to land, by quarter. A separate, longer timeline than the
                            operating runway.
                        </p>
                    </template>
                    <ReportsLendingCapitalChart :opportunities="trackOpportunities" />
                </UCard>

                <ReportsCoverageMap :opportunities="trackOpportunities" />
            </div>
        </template>
    </UDashboardPanel>
</template>
