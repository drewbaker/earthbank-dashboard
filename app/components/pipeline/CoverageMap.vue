<script setup lang="ts">
import { computed } from 'vue'
import type { Opportunity } from '#shared/schemas/index.ts'
import { MAP_COUNTRY_IDS } from '#shared/constants/map-country-ids.ts'
import { GLOBAL_FOCUS } from '#shared/constants/regions.ts'
import { countriesInFocus, geoFocusLabel } from '#shared/utils/geo-focus.ts'
import { useChartPalette } from '~/composables/useChartPalette.ts'
import { formatMoney } from '~/utils/format.ts'

const props = defineProps<{ opportunities: Opportunity[] }>()
const palette = useChartPalette()

// Declined asks don't count toward coverage.
const active = computed(() => props.opportunities.filter(opportunity => opportunity.stage !== 'lost'))

// Each country: the asks whose focus covers it (directly or through a region) and their amounts.
const areas = computed(() => {
    const byCountry = new Map<string, { count: number; amount: number; names: string[] }>()
    for (const opportunity of active.value) {
        for (const country of countriesInFocus({ codes: opportunity.focus_areas })) {
            const entry = byCountry.get(country) ?? { count: 0, amount: 0, names: [] }
            entry.count++
            entry.amount += (opportunity.amount_cents ?? 0) / 100
            entry.names.push(opportunity.funder.name)
            byCountry.set(country, entry)
        }
    }
    // The map's features are keyed by 3-letter codes; countries it doesn't draw are dropped.
    return [...byCountry.entries()].flatMap(([country, entry]) => {
        const id = MAP_COUNTRY_IDS[country]
        return id ? [{ id, value: entry.amount, ...entry }] : []
    })
})

const areasById = computed(() => new Map(areas.value.map(area => [area.id, area])))

/**
 * Coverage of the hovered country, by its map id.
 *
 * @param input.id - The map feature's id (3-letter ISO code).
 * @returns The asks covering it, or undefined.
 */
function coverageOf({ id }: { id: unknown }) {
    return areasById.value.get(String(id))
}

/**
 * A hovered country's name: ours from its 2-letter code, else the map's own name.
 *
 * @param input.properties - The map feature's properties (`iso_a2`, `name`).
 * @returns The name.
 */
function countryName({ properties }: { properties: Record<string, unknown> | undefined }) {
    const code = properties?.iso_a2
    return typeof code === 'string' && /^[A-Z]{2}$/.test(code)
        ? geoFocusLabel({ code })
        : String(properties?.name ?? 'Unknown')
}

const globalAsks = computed(() => active.value.filter(opportunity => opportunity.focus_areas.includes(GLOBAL_FOCUS)))
const unsetCount = computed(() => active.value.filter(opportunity => opportunity.focus_areas.length === 0).length)
const globalAmount = computed(() =>
    globalAsks.value.reduce((sum, opportunity) => sum + (opportunity.amount_cents ?? 0), 0),
)
</script>

<template>
    <UCard>
        <template #header>
            <h2 class="font-medium text-highlighted">Geographic coverage</h2>
            <p class="text-xs text-muted">
                Countries shaded by the money asked for them (an ask counts in full for every country it covers).
                Declined asks are left out.
            </p>
        </template>
        <ClientOnly>
            <TopoJSONMap
                :data="{ areas }"
                value="value"
                :color-range="['#d1fae5', palette.committed]"
                :height="380"
                projection="equalEarth"
            >
                <template #tooltip="{ kind, values }">
                    <div
                        v-if="kind === 'feature' && values"
                        class="max-w-64 space-y-1 rounded-md border border-default bg-elevated p-3 text-sm shadow-lg"
                    >
                        <p class="font-medium text-highlighted">{{ countryName({ properties: values.properties }) }}</p>
                        <template v-if="coverageOf({ id: values.id })">
                            <p>
                                {{ coverageOf({ id: values.id })!.count }} ask{{
                                    coverageOf({ id: values.id })!.count === 1 ? '' : 's'
                                }}
                                ·
                                {{ formatMoney({ cents: coverageOf({ id: values.id })!.amount * 100, compact: true }) }}
                            </p>
                            <p class="text-xs text-muted">{{ coverageOf({ id: values.id })!.names.join(', ') }}</p>
                        </template>
                        <p v-else class="text-muted">No asks focus here.</p>
                    </div>
                </template>
            </TopoJSONMap>
            <template #fallback><USkeleton class="h-95 w-full" /></template>
        </ClientOnly>
        <div class="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
            <p v-if="globalAsks.length">
                <UIcon name="i-lucide-globe" class="mr-1 inline size-4 align-text-bottom" />
                Global: {{ globalAsks.length }} ask{{ globalAsks.length === 1 ? '' : 's' }},
                {{ formatMoney({ cents: globalAmount, compact: true }) }}
                ({{ globalAsks.map(opportunity => opportunity.funder.name).join(', ') }})
            </p>
            <p v-if="unsetCount">
                {{ unsetCount }} ask{{ unsetCount === 1 ? ' has' : 's have' }} no geographic focus yet; set it on each
                opportunity.
            </p>
        </div>
    </UCard>
</template>
