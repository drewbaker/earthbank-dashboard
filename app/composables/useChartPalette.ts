import { computed } from 'vue'
import { useColorMode } from '#imports'

// Forecast series colors, checked with the dataviz palette validator (lightness band, CVD
// separation, contrast) against each mode's surface. Dark mode uses its own validated steps.
// `deficit` is the status color for "below $0": red, reserved for that, never a series hue.
const SERIES_COLORS = {
    light: { committed: '#15803d', weighted: '#2563eb', scenario: '#c2410c', deficit: '#dc2626' },
    dark: { committed: '#16a34a', weighted: '#3b82f6', scenario: '#ea580c', deficit: '#ef4444' },
} as const

// Grant stage colors, checked with the dataviz validator. Open stages are one blue ramp that reads
// "further along" as it strengthens (darker on light, lighter on dark); approved and received money
// get their own hues. Every use pairs the color with the stage name and amount.
const STAGE_COLORS = {
    light: {
        identified: '#86b6ef',
        in_discussion: '#5598e7',
        proposal: '#2a78d6',
        due_diligence: '#1c5cab',
        in_committee: '#104281',
        committed: '#008300',
        received: '#4a3aa7',
        lost: '#a1a1aa',
    },
    dark: {
        identified: '#184f95',
        in_discussion: '#256abf',
        proposal: '#3987e5',
        due_diligence: '#6da7ec',
        in_committee: '#9ec5f4',
        committed: '#008300',
        received: '#9085e9',
        lost: '#52525b',
    },
} as const

/**
 * Grant stage colors for the current color mode.
 *
 * @returns A computed stage → color map.
 */
export function useStageColors() {
    const colorMode = useColorMode()
    return computed(() => STAGE_COLORS[colorMode.value === 'dark' ? 'dark' : 'light'])
}

/**
 * Series colors for the current color mode.
 *
 * @returns A computed `{ committed, weighted, scenario, deficit }` color map.
 */
export function useChartPalette() {
    const colorMode = useColorMode()
    return computed(() => SERIES_COLORS[colorMode.value === 'dark' ? 'dark' : 'light'])
}
