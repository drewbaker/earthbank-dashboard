import { defineNuxtPlugin, useCookie } from '#imports'

// The browser's time zone, shared with the server in a cookie so server-rendered pages show times
// and "today" in the viewer's zone (the server itself runs in UTC). Read by app/utils/format.ts.
const TIME_ZONE_COOKIE = 'earthbank_dashboard_tz'
// Used only on the very first visit, before the browser has set the cookie.
const FALLBACK_TIME_ZONE = 'America/Los_Angeles'

export default defineNuxtPlugin(() => {
    const cookie = useCookie<string | null>(TIME_ZONE_COOKIE, {
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
        path: '/',
    })
    if (import.meta.client) {
        const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
        if (browserTimeZone && cookie.value !== browserTimeZone) {
            cookie.value = browserTimeZone
        }
    }
    return { provide: { timeZone: cookie.value || FALLBACK_TIME_ZONE } }
})
