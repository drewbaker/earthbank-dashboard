import { computed } from 'vue'
import { useColorMode } from '#imports'

// Forecast series colors, checked with the dataviz palette validator (lightness band, CVD
// separation, contrast) against each mode's surface. Dark mode uses its own validated steps.
// `deficit` is the status color for "below $0": red, reserved for that, never a series hue.
const SERIES_COLORS = {
    light: { committed: '#15803d', weighted: '#2563eb', scenario: '#c2410c', deficit: '#dc2626' },
    dark: { committed: '#16a34a', weighted: '#3b82f6', scenario: '#ea580c', deficit: '#ef4444' },
} as const

/**
 * Series colors for the current color mode.
 *
 * @returns A computed `{ committed, weighted, scenario, deficit }` color map.
 */
export function useChartPalette() {
    const colorMode = useColorMode()
    return computed(() => SERIES_COLORS[colorMode.value === 'dark' ? 'dark' : 'light'])
}
