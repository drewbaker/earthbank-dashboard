import { computed } from 'vue'
import { useColorMode } from '#imports'

// Forecast series colors, checked with the dataviz palette validator (lightness band, CVD
// separation, contrast) against each mode's surface. Dark mode uses its own validated steps.
// `deficit` is the status color for "below $0": red, reserved for that, never a series hue.
const SERIES_COLORS = {
    light: { committed: '#15803d', weighted: '#2563eb', scenario: '#c2410c', deficit: '#dc2626' },
    dark: { committed: '#16a34a', weighted: '#3b82f6', scenario: '#ea580c', deficit: '#ef4444' },
} as const

// Grant stage colors, after the nuxt-charts shadcn dashboard (indigo, emerald, orange, purple, amber,
// pink), ordered so neighbouring stages contrast, and checked with the dataviz validator (CVD and
// normal-vision separation) on each mode's surface. Identified is neutral gray on purpose: not yet
// engaged. Every use pairs the color with the stage name and amount.
const STAGE_COLORS = {
    light: {
        received: '#4f46e5',
        committed: '#059669',
        in_committee: '#ea580c',
        due_diligence: '#9333ea',
        proposal: '#ca8a04',
        in_discussion: '#db2777',
        identified: '#71717a',
        lost: '#a1a1aa',
    },
    dark: {
        received: '#6366f1',
        committed: '#059669',
        in_committee: '#ea580c',
        due_diligence: '#9333ea',
        proposal: '#b45309',
        in_discussion: '#db2777',
        identified: '#71717a',
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
