import type { H3Event } from 'h3'
import { getCookie } from 'h3'
import { config } from '#server/utils/config.ts'
import { todayDateOnly } from '#server/utils/dates.ts'

/** Set by the browser (app/plugins/time-zone.ts) so the server can use the viewer's time zone. */
export const TIME_ZONE_COOKIE = 'earthbank_dashboard_tz'

/**
 * Whether a string is a time zone this runtime knows.
 *
 * @param input.timeZone - Candidate IANA zone.
 * @returns True when valid.
 */
export function isValidTimeZone({ timeZone }: { timeZone: string }) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone })
        return true
    } catch {
        return false
    }
}

/**
 * The viewer's time zone from their browser's cookie, else the team default (`APP_TIME_ZONE`).
 *
 * @param input.event - The request.
 * @returns An IANA zone.
 */
export function requestTimeZone({ event }: { event: H3Event }) {
    const fromCookie = getCookie(event, TIME_ZONE_COOKIE)
    return fromCookie && isValidTimeZone({ timeZone: fromCookie }) ? fromCookie : config.defaultTimeZone
}

/**
 * Today's date for the person making the request.
 *
 * @param input.event - The request.
 * @returns YYYY-MM-DD.
 */
export function requestToday({ event }: { event: H3Event }) {
    return todayDateOnly({ timeZone: requestTimeZone({ event }) })
}
