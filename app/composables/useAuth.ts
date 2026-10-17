import { computed } from 'vue'
import { navigateTo, useState } from '#imports'
import type { CurrentUser, User, UserPreferences } from '#shared/schemas/index.ts'
import { useApi } from '~/composables/useApi.ts'

/**
 * The signed-in user and their preferences, loaded once per visit by `auth.global.ts`.
 *
 * @returns The user state, their preferences, a loader and sign-out.
 */
export function useAuth() {
    const api = useApi()
    const currentUser = useState<User | null>('auth.currentUser', () => null)
    const preferences = useState<UserPreferences | null>('auth.preferences', () => null)
    const hasLoaded = useState<boolean>('auth.hasLoaded', () => false)

    /**
     * Load `/v1/auth/me` unless it has already been loaded.
     *
     * @returns The user, or null when signed out.
     */
    async function loadCurrentUser() {
        if (hasLoaded.value) {
            return currentUser.value
        }
        try {
            const response = await api<CurrentUser>({ path: '/auth/me' })
            currentUser.value = response.user
            preferences.value = response.preferences
        } catch {
            currentUser.value = null
            preferences.value = null
        }
        hasLoaded.value = true
        return currentUser.value
    }

    /**
     * End the session and go to the login page.
     *
     * @returns Resolves after navigation.
     */
    async function signOut() {
        await api({ path: '/auth/logout', method: 'POST' })
        currentUser.value = null
        preferences.value = null
        await navigateTo('/login')
    }

    return {
        currentUser,
        preferences,
        isSignedIn: computed(() => currentUser.value !== null),
        loadCurrentUser,
        signOut,
    }
}
