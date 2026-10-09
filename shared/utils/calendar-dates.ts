// Calendar-date arithmetic on `YYYY-MM-DD` strings, in UTC so results never shift with time zones.

/**
 * Parse `YYYY-MM-DD` as UTC midnight.
 *
 * @param input.value - Date string.
 * @returns The Date.
 */
export function parseCalendarDate({ value }: { value: string }) {
    return new Date(`${value.slice(0, 10)}T00:00:00Z`)
}

/**
 * Format a Date as `YYYY-MM-DD` (UTC).
 *
 * @param input.date - The Date.
 * @returns The date string.
 */
export function formatCalendarDate({ date }: { date: Date }) {
    return date.toISOString().slice(0, 10)
}

/**
 * Add whole months, clamping the day to the end of shorter months (Jan 31 + 1 month = Feb 28).
 *
 * @param input.value - Start date.
 * @param input.months - Months to add (may be negative).
 * @returns The new date string.
 */
export function addMonths({ value, months }: { value: string; months: number }) {
    const date = parseCalendarDate({ value })
    const day = date.getUTCDate()
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
    target.setUTCDate(Math.min(day, lastDay))
    return formatCalendarDate({ date: target })
}

/**
 * First day of the month containing a date.
 *
 * @param input.value - Any date in the month.
 * @returns `YYYY-MM-01`.
 */
export function firstOfMonth({ value }: { value: string }) {
    return `${value.slice(0, 7)}-01`
}

/**
 * Last day of the month containing a date.
 *
 * @param input.value - Any date in the month.
 * @returns The month's last date.
 */
export function lastOfMonth({ value }: { value: string }) {
    const date = parseCalendarDate({ value })
    return formatCalendarDate({ date: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)) })
}

/**
 * Whole days from one date to another (positive when `to` is later).
 *
 * @param input.from - Start date.
 * @param input.to - End date.
 * @returns The number of days.
 */
export function daysBetween({ from, to }: { from: string; to: string }) {
    return Math.round(
        (parseCalendarDate({ value: to }).getTime() - parseCalendarDate({ value: from }).getTime()) / 86_400_000,
    )
}

/**
 * Add whole days.
 *
 * @param input.value - Start date.
 * @param input.days - Days to add.
 * @returns The new date string.
 */
export function addDays({ value, days }: { value: string; days: number }) {
    return formatCalendarDate({ date: new Date(parseCalendarDate({ value }).getTime() + days * 86_400_000) })
}
