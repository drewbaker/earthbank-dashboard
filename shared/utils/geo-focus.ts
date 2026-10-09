import { COUNTRY_CODES, GEO_REGIONS, GLOBAL_FOCUS } from '#shared/constants/regions.ts'

const COUNTRIES = new Set(COUNTRY_CODES)
const REGIONS = new Map(GEO_REGIONS.map(region => [region.code, region]))
const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' })

/**
 * Whether a focus code is known: a country code, a region code or "global".
 *
 * @param input.code - The code.
 * @returns True when valid.
 */
export function isGeoFocusCode({ code }: { code: string }) {
    return code === GLOBAL_FOCUS || COUNTRIES.has(code) || REGIONS.has(code as `region:${string}`)
}

/**
 * A focus code's name: "Kenya", "East Africa", "Global".
 *
 * @param input.code - The code.
 * @returns Its display name.
 */
export function geoFocusLabel({ code }: { code: string }) {
    if (code === GLOBAL_FOCUS) {
        return 'Global'
    }
    const region = REGIONS.get(code as `region:${string}`)
    if (region) {
        return region.label
    }
    return COUNTRY_NAMES.of(code) ?? code
}

/**
 * The countries a set of focus codes covers (regions expanded). "Global" covers none here; it's
 * reported on its own rather than painting every country.
 *
 * @param input.codes - Focus codes.
 * @returns Country codes.
 */
export function countriesInFocus({ codes }: { codes: string[] }) {
    const countries = new Set<string>()
    for (const code of codes) {
        const region = REGIONS.get(code as `region:${string}`)
        if (region) {
            region.countries.forEach(country => countries.add(country))
        } else if (COUNTRIES.has(code)) {
            countries.add(code)
        }
    }
    return countries
}

/**
 * Every focus option for a picker: Global, then regions, then countries by name.
 *
 * @returns Options with code, label and group.
 */
export function geoFocusOptions() {
    return [
        { code: GLOBAL_FOCUS, label: 'Global', group: 'Global' as const },
        ...GEO_REGIONS.map(region => ({ code: region.code, label: region.label, group: 'Regions' as const })),
        ...COUNTRY_CODES.map(code => ({ code, label: geoFocusLabel({ code }), group: 'Countries' as const })).sort(
            (first, second) => first.label.localeCompare(second.label),
        ),
    ]
}
