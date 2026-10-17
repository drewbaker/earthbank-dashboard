import { computed } from 'vue'
import { useColorMode } from '#imports'
import type { ColorMode } from '#shared/schemas/index.ts'
import { useApi } from '~/composables/useApi.ts'
import { useAuth } from '~/composables/useAuth.ts'

/**
 * Light, dark or auto, saved to the signed-in person's account so it follows them to any browser.
 *
 * The browser keeps its own copy too (so the page paints in the right mode before anything loads);
 * the account's choice wins once it's known.
 *
 * @returns The current choice, a setter that saves it, and a function that applies the saved choice.
 */
export function useColorModePreference() {
    const api = useApi()
    const colorMode = useColorMode()
    const { preferences } = useAuth()

    const colorModeChoice = computed(() => colorMode.preference as ColorMode)

    /**
     * Switch mode now and save it to the account.
     *
     * @param input.mode - `light`, `dark` or `system`.
     * @returns Resolves once saved (a failed save, or being signed out, keeps it to this browser).
     */
    async function chooseColorMode({ mode }: { mode: ColorMode }) {
        colorMode.preference = mode
        // Signed out (a share page): the choice only lives in this browser.
        if (!preferences.value) {
            return
        }
        preferences.value = { ...preferences.value, color_mode: mode }
        await api({ path: '/auth/me/preferences', method: 'PATCH', body: { color_mode: mode } }).catch(error =>
            console.error('[preferences] saving color mode failed', error),
        )
    }

    /**
     * Use the account's saved mode in this browser.
     *
     * @returns Nothing.
     */
    function applySavedColorMode() {
        const saved = preferences.value?.color_mode
        if (saved && colorMode.preference !== saved) {
            colorMode.preference = saved
        }
    }

    return { colorModeChoice, chooseColorMode, applySavedColorMode }
}
