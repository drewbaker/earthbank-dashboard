const compactMoney = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
})
const fullMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/**
 * Format cents as US dollars.
 *
 * @param input.cents - Amount in cents, or null when unknown.
 * @param input.compact - Short form for tiles and charts (`$1.5M`).
 * @param input.unknown - Text shown when the amount is unknown.
 * @returns The formatted amount.
 */
export function formatMoney({
    cents,
    compact = false,
    unknown = '—',
}: {
    cents: number | null | undefined
    compact?: boolean
    unknown?: string
}) {
    if (cents === null || cents === undefined) {
        return unknown
    }
    return (compact ? compactMoney : fullMoney).format(cents / 100)
}

/**
 * Format a calendar date (`YYYY-MM-DD`) or timestamp for display.
 *
 * Calendar dates are formatted in UTC so "2026-01-01" never shows as Dec 31 in US time zones.
 *
 * @param input.value - Date string, or null.
 * @param input.style - `medium` (Jan 1, 2026) or `short` (Jan 1).
 * @param input.unknown - Text shown when there's no date.
 * @returns The formatted date.
 */
export function formatDate({
    value,
    style = 'medium',
    unknown = '—',
}: {
    value: string | null | undefined
    style?: 'medium' | 'short'
    unknown?: string
}) {
    if (!value) {
        return unknown
    }
    const isCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(value)
    const date = new Date(isCalendarDate ? `${value}T00:00:00Z` : value)
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: style === 'medium' ? 'numeric' : undefined,
        timeZone: isCalendarDate ? 'UTC' : undefined,
    })
}

/**
 * Format a timestamp relative to now ("3 days ago", "in 2 weeks").
 *
 * @param input.value - ISO timestamp or calendar date.
 * @param input.now - Reference time (for tests).
 * @returns The relative description.
 */
export function formatRelativeTime({ value, now = new Date() }: { value: string; now?: Date }) {
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value)
    const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['year', 31_536_000],
        ['month', 2_592_000],
        ['week', 604_800],
        ['day', 86_400],
        ['hour', 3_600],
        ['minute', 60],
    ]
    const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) {
            return formatter.format(Math.round(seconds / size), unit)
        }
    }
    return 'just now'
}

/**
 * Dollars typed in a form → cents.
 *
 * @param input.dollars - Dollar amount, or null/undefined when blank.
 * @returns Cents, or null.
 */
export function dollarsToCents({ dollars }: { dollars: number | null | undefined }) {
    return dollars === null || dollars === undefined || Number.isNaN(dollars) ? null : Math.round(dollars * 100)
}

/**
 * Cents → dollars for a form field.
 *
 * @param input.cents - Cents, or null.
 * @returns Dollars, or undefined when blank (so number inputs show empty).
 */
export function centsToDollars({ cents }: { cents: number | null | undefined }) {
    return cents === null || cents === undefined ? undefined : cents / 100
}
