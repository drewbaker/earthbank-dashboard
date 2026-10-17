import { daysBetween } from '#shared/utils/calendar-dates.ts'

// How long a live ask can go without contact before it's flagged: over 5 days is a nudge (yellow),
// over 10 days needs attention (red).
export const CONTACT_STALE_AFTER_DAYS = 5
export const CONTACT_OVERDUE_AFTER_DAYS = 10

export type ContactStaleness = 'recent' | 'stale' | 'overdue' | 'never'

/**
 * How overdue a follow-up is, from the last contact date.
 *
 * @param input.lastContactAt - Last contact date (`YYYY-MM-DD`), or null when none is logged.
 * @param input.today - Today in the viewer's zone (`YYYY-MM-DD`).
 * @returns `recent` (5 days or fewer), `stale` (6–10 days), `overdue` (over 10) or `never`.
 */
export function contactStaleness({ lastContactAt, today }: { lastContactAt: string | null; today: string }) {
    if (!lastContactAt) {
        return 'never' satisfies ContactStaleness
    }
    const days = daysSinceContact({ lastContactAt, today })
    if (days > CONTACT_OVERDUE_AFTER_DAYS) {
        return 'overdue' satisfies ContactStaleness
    }
    if (days > CONTACT_STALE_AFTER_DAYS) {
        return 'stale' satisfies ContactStaleness
    }
    return 'recent' satisfies ContactStaleness
}

/**
 * Whole days since the last contact (0 on the day itself; never negative).
 *
 * @param input.lastContactAt - Last contact date (`YYYY-MM-DD`).
 * @param input.today - Today (`YYYY-MM-DD`).
 * @returns The number of days.
 */
export function daysSinceContact({ lastContactAt, today }: { lastContactAt: string; today: string }) {
    return Math.max(0, daysBetween({ from: lastContactAt, to: today }))
}
