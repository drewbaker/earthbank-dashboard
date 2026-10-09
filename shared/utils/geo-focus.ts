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

// Shorthand the team writes that isn't a country or region name.
const FOCUS_ALIASES: Record<string, string> = {
    worldwide: GLOBAL_FOCUS,
    international: GLOBAL_FOCUS,
    em: 'region:emerging_markets',
    emerging: 'region:emerging_markets',
    latam: 'region:latin_america',
    'latin america': 'region:latin_america',
    ssa: 'region:sub_saharan_africa',
    us: 'US',
    usa: 'US',
    'united states of america': 'US',
    america: 'US',
    uk: 'GB',
    'great britain': 'GB',
    england: 'GB',
    drc: 'CD',
    'ivory coast': 'CI',
}

/**
 * Read focus codes from free text like the spreadsheet's "Geo Focus" column ("Africa, India",
 * "US, Global", "EM"). Country and region names match case-insensitively.
 *
 * @param input.text - The text.
 * @returns The codes found (no duplicates) and the parts that didn't match anything.
 */
export function focusCodesFromText({ text }: { text: string | null }) {
    const names = focusNameIndex()
    const codes: string[] = []
    const unmatched: string[] = []
    for (const part of (text ?? '').split(/[,;/&+]|\band\b/i)) {
        const name = part
            .trim()
            .toLowerCase()
            .replace(/\./g, '')
            .replace(/^the\s+/, '')
        if (!name) {
            continue
        }
        const code = FOCUS_ALIASES[name] ?? names.get(name)
        if (!code) {
            unmatched.push(part.trim())
        } else if (!codes.includes(code)) {
            codes.push(code)
        }
    }
    return { codes, unmatched }
}

let cachedNameIndex: Map<string, string> | null = null

/**
 * Lowercased name → code for Global, every region and every country.
 *
 * @returns The index.
 */
function focusNameIndex() {
    if (!cachedNameIndex) {
        cachedNameIndex = new Map(
            geoFocusOptions().map(option => [option.label.toLowerCase().replace(/\./g, ''), option.code] as const),
        )
    }
    return cachedNameIndex
}
