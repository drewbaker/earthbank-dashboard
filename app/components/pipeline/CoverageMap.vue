<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { geoEqualEarth, geoPath } from 'd3-geo'
import type { MultiPolygon } from 'geojson'
import { computed, ref, useTemplateRef } from 'vue'
import { MAP_COUNTRY_IDS } from '#shared/constants/map-country-ids.ts'
import { GLOBAL_FOCUS } from '#shared/constants/regions.ts'
import { countriesInFocus, geoFocusLabel } from '#shared/utils/geo-focus.ts'
import { useChartPalette } from '~/composables/useChartPalette.ts'
import type { CoverageAsk } from '~/utils/coverage-asks.ts'
import { formatMoney } from '~/utils/format.ts'

// Also used by the funder-facing share page, so it takes plain asks rather than opportunities.
const props = defineProps<{ asks: CoverageAsk[] }>()
const palette = useChartPalette()

// The map is fitted to the inhabited world (latitude -56° to 84°) at the card's width, with the height
// following from that. Antarctica has no asks, and the chart library's own fit misjudges its size,
// which pushed the rest of the world down and cut off the bottom of Australia and South America.
const MAP_PADDING = 8
const INHABITED_WORLD: MultiPolygon = {
    type: 'MultiPolygon',
    coordinates: Array.from({ length: 36 }, (_, index) => {
        const west = -180 + index * 10
        return [
            [
                [west, -56],
                [west, 84],
                [west + 10, 84],
                [west + 10, -56],
                [west, -56],
            ],
        ]
    }),
}
const mapBox = useTemplateRef<HTMLElement>('mapBox')
const { width: mapBoxWidth } = useElementSize(mapBox)
const mapView = computed(() => {
    const width = Math.max(320, Math.round(mapBoxWidth.value || 900))
    const projection = geoEqualEarth().fitWidth(width - MAP_PADDING * 2, INHABITED_WORLD)
    const [[, top], [, bottom]] = geoPath(projection).bounds(INHABITED_WORLD)
    const height = Math.round(bottom - top + MAP_PADDING * 2)
    const [x, y] = projection.translate()
    projection.translate([x + MAP_PADDING, y - top + MAP_PADDING])
    return { projection, height }
})

// Declined asks don't count toward coverage.
const active = computed(() => props.asks.filter(ask => ask.stage !== 'lost'))

// Each country: the asks whose focus covers it (directly or through a region) and their amounts.
// Global asks are kept apart: painting every country with them would make the map say nothing.
const areas = computed(() => {
    const byCountry = new Map<string, { count: number; amount: number; names: string[] }>()
    for (const ask of active.value) {
        for (const country of countriesInFocus({ codes: ask.focus_areas })) {
            const entry = byCountry.get(country) ?? { count: 0, amount: 0, names: [] }
            entry.count++
            entry.amount += (ask.amount_cents ?? 0) / 100
            entry.names.push(ask.organization)
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

const globalAsks = computed(() =>
    active.value
        .filter(ask => ask.focus_areas.includes(GLOBAL_FOCUS))
        .sort((first, second) => (second.amount_cents ?? 0) - (first.amount_cents ?? 0)),
)
const globalAmount = computed(() => globalAsks.value.reduce((sum, ask) => sum + (ask.amount_cents ?? 0), 0))
const unsetCount = computed(() => active.value.filter(ask => ask.focus_areas.length === 0).length)

// While someone hovers the Global badge, every country is lightly tinted: global money covers all of them.
const isGlobalHovered = ref(false)

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

/**
 * "1 ask" / "3 asks".
 *
 * @param input.count - How many.
 * @returns The phrase.
 */
function askCount({ count }: { count: number }) {
    return `${count} ask${count === 1 ? '' : 's'}`
}
</script>

<template>
    <UCard>
        <template #header>
            <h2 class="font-medium text-highlighted">Geographic coverage</h2>
            <p class="text-xs text-muted">
                Countries shaded by region of focus. Global asks cover every country and are also shown on their own.
            </p>
        </template>
        <ClientOnly>
            <div ref="mapBox" class="relative">
                <TopoJSONMap
                    :data="{ areas }"
                    value="value"
                    :color-range="['#d1fae5', palette.committed]"
                    :height="mapView.height"
                    :projection="mapView.projection"
                    :fit-view="false"
                >
                    <template #tooltip="{ kind, values }">
                        <div
                            v-if="kind === 'feature' && values"
                            class="max-w-72 space-y-1 rounded-md border border-default bg-elevated p-3 text-sm shadow-lg"
                        >
                            <p class="font-medium text-highlighted">
                                {{ countryName({ properties: values.properties }) }}
                                <template v-if="coverageOf({ id: values.id }) || globalAsks.length">
                                    ·
                                    {{
                                        formatMoney({
                                            cents: (coverageOf({ id: values.id })?.amount ?? 0) * 100 + globalAmount,
                                            compact: true,
                                        })
                                    }}
                                </template>
                            </p>
                            <template v-if="coverageOf({ id: values.id })">
                                <p>
                                    {{
                                        formatMoney({
                                            cents: coverageOf({ id: values.id })!.amount * 100,
                                            compact: true,
                                        })
                                    }}
                                    for this country or its region ·
                                    {{ askCount({ count: coverageOf({ id: values.id })!.count }) }}
                                </p>
                                <p class="text-xs text-muted">{{ coverageOf({ id: values.id })!.names.join(', ') }}</p>
                            </template>
                            <p v-else class="text-muted">No asks for this country or its region.</p>
                            <p v-if="globalAsks.length" class="border-t border-default pt-1 text-xs text-muted">
                                + {{ formatMoney({ cents: globalAmount, compact: true }) }} from
                                {{ globalAsks.length }} global fund{{ globalAsks.length === 1 ? '' : 's' }}
                            </p>
                        </div>
                    </template>
                </TopoJSONMap>

                <!-- Global money covers every country: hovering the badge tints the whole map. -->
                <div
                    v-if="isGlobalHovered"
                    class="pointer-events-none absolute inset-0 rounded-md bg-success/10 ring-1 ring-success/40 ring-inset"
                />
                <UPopover
                    v-if="globalAsks.length"
                    mode="hover"
                    :open-delay="0"
                    :content="{ side: 'top', align: 'start' }"
                    class="absolute bottom-3 left-3"
                    @update:open="open => (isGlobalHovered = open)"
                >
                    <UButton
                        icon="i-lucide-globe"
                        color="primary"
                        variant="subtle"
                        size="sm"
                        class="rounded-full"
                        :label="`Global · ${askCount({ count: globalAsks.length })} · ${formatMoney({ cents: globalAmount, compact: true })}`"
                    />
                    <template #content>
                        <div class="max-w-72 space-y-1 p-3 text-sm">
                            <p class="font-medium text-highlighted">Global funds</p>
                            <p v-for="ask in globalAsks" :key="ask.key" class="flex justify-between gap-4">
                                <span class="text-toned">{{ ask.organization }}</span>
                                <span class="shrink-0 text-highlighted">
                                    {{
                                        ask.amount_cents
                                            ? formatMoney({ cents: ask.amount_cents, compact: true })
                                            : 'TBD'
                                    }}
                                </span>
                            </p>
                            <p class="pt-1 text-xs text-muted">These cover every country.</p>
                        </div>
                    </template>
                </UPopover>
            </div>
            <template #fallback><USkeleton class="h-95 w-full" /></template>
        </ClientOnly>
        <p v-if="unsetCount" class="mt-4 text-sm text-muted">
            {{ unsetCount }} ask{{ unsetCount === 1 ? ' has' : 's have' }} no geographic focus yet.
        </p>
    </UCard>
</template>
