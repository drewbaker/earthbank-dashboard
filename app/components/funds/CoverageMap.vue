<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { geoEqualEarth, geoPath } from 'd3-geo'
import type { MultiPolygon } from 'geojson'
import { computed, ref, useTemplateRef } from 'vue'
import { MAP_COUNTRY_IDS } from '#shared/constants/map-country-ids.ts'
import { GEO_REGIONS, GLOBAL_FOCUS } from '#shared/constants/regions.ts'
import type { Fund } from '#shared/schemas/index.ts'
import { countriesInFocus, geoFocusLabel } from '#shared/utils/geo-focus.ts'
import { useChartPalette } from '~/composables/useChartPalette.ts'

// Where the funds on the list lend, so gaps in regional coverage stand out. A fund counts in each
// country its focus covers; with no focus found yet, its HQ country stands in. Global funds are kept
// apart (like the pipeline map), since painting every country with them would hide the gaps.

const props = defineProps<{ funds: Fund[] }>()
const palette = useChartPalette()

type CoverageMeasure = 'all' | 'ticket_fit' | 'advanced'
const measure = ref<CoverageMeasure>('all')
const measureItems = [
    { label: 'All funds', value: 'all' },
    { label: 'Fit our ticket', value: 'ticket_fit' },
    { label: 'In diligence or shortlisted', value: 'advanced' },
]

// The regions Earth Bank wants a good lender in, each checked for at least one fund.
const COVERAGE_REGIONS = [
    'region:eastern_africa',
    'region:western_africa',
    'region:middle_africa',
    'region:southern_africa',
    'region:northern_africa',
    'region:south_america',
    'region:central_america',
    'region:caribbean',
    'region:north_america',
    'region:south_asia',
    'region:southeast_asia',
    'region:east_asia',
    'region:central_asia',
    'region:middle_east',
    'region:europe',
    'region:oceania',
]

// Fitted to the inhabited world, as on the pipeline map (the library's own fit cuts off the south).
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

const measuredFunds = computed(() =>
    props.funds.filter(fund => {
        if (measure.value === 'ticket_fit') {
            return fund.ticket_fit === 'fits' || fund.ticket_fit === 'partly'
        }
        if (measure.value === 'advanced') {
            return fund.stage === 'in_diligence' || fund.stage === 'shortlisted'
        }
        return fund.stage !== 'passed'
    }),
)

const globalFunds = computed(() => measuredFunds.value.filter(fund => fund.focus_areas.includes(GLOBAL_FOCUS)))

// Each fund's countries: its focus, else its HQ; global funds are counted on their own.
const fundCountries = computed(() =>
    measuredFunds.value
        .filter(fund => !fund.focus_areas.includes(GLOBAL_FOCUS))
        .map(fund => ({
            fund,
            countries: new Set(
                fund.focus_areas.length > 0
                    ? countriesInFocus({ codes: fund.focus_areas })
                    : fund.hq_country
                      ? [fund.hq_country]
                      : [],
            ),
            isFromHeadquarters: fund.focus_areas.length === 0,
        })),
)
const unplacedCount = computed(() => fundCountries.value.filter(entry => entry.countries.size === 0).length)

const areas = computed(() => {
    const byCountry = new Map<string, string[]>()
    for (const { fund, countries } of fundCountries.value) {
        for (const country of countries) {
            byCountry.set(country, [...(byCountry.get(country) ?? []), fund.name])
        }
    }
    return [...byCountry.entries()].flatMap(([country, names]) => {
        const id = MAP_COUNTRY_IDS[country]
        return id ? [{ id, value: names.length, names }] : []
    })
})
const areasById = computed(() => new Map(areas.value.map(area => [area.id, area])))

const regionCoverage = computed(() =>
    COVERAGE_REGIONS.flatMap(code => {
        const region = GEO_REGIONS.find(candidate => candidate.code === code)
        if (!region) {
            return []
        }
        const regionCountries = new Set(region.countries)
        const funds = fundCountries.value
            .filter(entry => [...entry.countries].some(country => regionCountries.has(country)))
            .map(entry => entry.fund)
        return [{ code, label: region.label, funds }]
    }),
)
const gapCount = computed(() => regionCoverage.value.filter(region => region.funds.length === 0).length)

const isGlobalHovered = ref(false)

/**
 * The funds covering a hovered country, by its map id.
 *
 * @param input.id - The map feature's id (3-letter ISO code).
 * @returns The coverage, or undefined.
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
 * "1 fund" / "3 funds".
 *
 * @param input.count - How many.
 * @returns The phrase.
 */
function fundCount({ count }: { count: number }) {
    return `${count} fund${count === 1 ? '' : 's'}`
}

/**
 * A short list of names for a tooltip.
 *
 * @param input.names - Fund names.
 * @returns Up to 8 names, then "and N more".
 */
function nameList({ names }: { names: string[] }) {
    return names.length > 8 ? `${names.slice(0, 8).join(', ')} and ${names.length - 8} more` : names.join(', ')
}
</script>

<template>
    <div class="fund-coverage grid gap-4 xl:grid-cols-3">
        <UCard class="xl:col-span-2">
            <template #header>
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 class="font-medium text-highlighted">Geographic coverage</h2>
                        <p class="text-xs text-muted">
                            Countries shaded by how many funds lend there (their focus, else their HQ). Global funds are
                            shown on their own.
                        </p>
                    </div>
                    <UTabs v-model="measure" :items="measureItems" :content="false" size="xs" />
                </div>
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
                                </p>
                                <template v-if="coverageOf({ id: values.id })">
                                    <p>{{ fundCount({ count: coverageOf({ id: values.id })!.value }) }}</p>
                                    <p class="text-xs text-muted">
                                        {{ nameList({ names: coverageOf({ id: values.id })!.names }) }}
                                    </p>
                                </template>
                                <p v-else class="text-muted">No funds lend here yet.</p>
                                <p v-if="globalFunds.length" class="border-t border-default pt-1 text-xs text-muted">
                                    + {{ fundCount({ count: globalFunds.length }) }} with a global focus
                                </p>
                            </div>
                        </template>
                    </TopoJSONMap>
                    <div
                        v-if="isGlobalHovered"
                        class="pointer-events-none absolute inset-0 rounded-md bg-success/10 ring-1 ring-success/40 ring-inset"
                    />
                    <UPopover
                        v-if="globalFunds.length"
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
                            :label="`Global · ${fundCount({ count: globalFunds.length })}`"
                        />
                        <template #content>
                            <div class="max-w-72 space-y-1 p-3 text-sm">
                                <p class="font-medium text-highlighted">Global funds</p>
                                <ULink
                                    v-for="fund in globalFunds"
                                    :key="fund.id"
                                    :to="`/funds/${fund.id}`"
                                    class="block text-toned hover:underline"
                                >
                                    {{ fund.name }}
                                </ULink>
                            </div>
                        </template>
                    </UPopover>
                </div>
                <template #fallback><USkeleton class="h-95 w-full" /></template>
            </ClientOnly>
            <p v-if="unplacedCount" class="mt-4 text-sm text-muted">
                {{ fundCount({ count: unplacedCount }) }} with no focus or HQ found yet.
            </p>
        </UCard>

        <UCard>
            <template #header>
                <h2 class="font-medium text-highlighted">Regions</h2>
                <p class="text-xs text-muted">
                    {{
                        gapCount === 0
                            ? 'Every region has at least one fund.'
                            : `${gapCount} region${gapCount === 1 ? ' has' : 's have'} no fund yet${globalFunds.length ? ' (besides global funds)' : ''}.`
                    }}
                </p>
            </template>
            <ul class="divide-y divide-default">
                <li
                    v-for="region in regionCoverage"
                    :key="region.code"
                    class="flex items-center justify-between gap-3 py-2 text-sm"
                    :class="{ 'is-coverage-gap': region.funds.length === 0 }"
                >
                    <UTooltip
                        :text="nameList({ names: region.funds.map(fund => fund.name) })"
                        :disabled="region.funds.length === 0"
                    >
                        <span :class="region.funds.length ? 'text-highlighted' : 'text-muted'">{{ region.label }}</span>
                    </UTooltip>
                    <UBadge
                        :label="region.funds.length ? fundCount({ count: region.funds.length }) : 'Gap'"
                        :color="region.funds.length >= 3 ? 'success' : region.funds.length ? 'info' : 'warning'"
                        size="sm"
                    />
                </li>
            </ul>
        </UCard>
    </div>
</template>
