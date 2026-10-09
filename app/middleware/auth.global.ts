import { defineNuxtRouteMiddleware, navigateTo } from '#imports'
import { useAuth } from '~/composables/useAuth.ts'

declare module '#app' {
    interface PageMeta {
        /** Reachable while signed out (only the login page). */
        public?: boolean
    }
}

// Everything is private except pages that declare `public: true`.
export default defineNuxtRouteMiddleware(async to => {
    const { loadCurrentUser } = useAuth()
    const user = await loadCurrentUser()
    if (to.meta.public) {
        if (user && to.path === '/login') {
            return navigateTo('/')
        }
        return
    }
    if (!user) {
        return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
    }
})
