import { computed } from 'vue'
import { useColorMode } from '#imports'

// Forecast series colors, checked with the dataviz palette validator (lightness band, CVD
// separation, contrast) against each mode's surface. Dark mode uses its own validated steps.
const SERIES_COLORS = {
    light: { committed: '#15803d', weighted: '#2563eb', scenario: '#c2410c' },
    dark: { committed: '#16a34a', weighted: '#3b82f6', scenario: '#ea580c' },
} as const

/**
 * Series colors for the current color mode.
 *
 * @returns A computed `{ committed, weighted, scenario }` color map.
 */
export function useChartPalette() {
    const colorMode = useColorMode()
    return computed(() => SERIES_COLORS[colorMode.value === 'dark' ? 'dark' : 'light'])
}
