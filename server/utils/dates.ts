/**
 * Format a stored calendar date as `YYYY-MM-DD`. Calendar dates are stored at UTC midnight.
 *
 * @param input.date - The stored date, or null.
 * @returns The date string, or null.
 */
export function toDateOnly({ date }: { date: Date | null | undefined }) {
    return date ? date.toISOString().slice(0, 10) : null
}

/**
 * Turn `YYYY-MM-DD` into the Date stored for it (UTC midnight).
 *
 * @param input.value - Date string, or null.
 * @returns The Date, or null.
 */
export function fromDateOnly({ value }: { value: string | null | undefined }) {
    return value ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : null
}

/**
 * Format a timestamp as ISO 8601, keeping null.
 *
 * @param input.date - The timestamp, or null.
 * @returns The ISO string, or null.
 */
export function toIsoDateTime({ date }: { date: Date | null | undefined }) {
    return date ? date.toISOString() : null
}

/**
 * Convert stored BigInt cents to a plain number for the API.
 *
 * @param input.cents - Stored cents, or null.
 * @returns Cents as a number, or null.
 */
export function centsToNumber({ cents }: { cents: bigint | null | undefined }) {
    return cents === null || cents === undefined ? null : Number(cents)
}

/**
 * Convert API cents to the stored BigInt.
 *
 * @param input.cents - Cents as a number, or null.
 * @returns BigInt cents, or null.
 */
export function centsToBigInt({ cents }: { cents: number | null | undefined }) {
    return cents === null || cents === undefined ? null : BigInt(Math.round(cents))
}

/**
 * Today's calendar date in a time zone (the viewer's, so "today" and "overdue" roll over at their
 * midnight, not UTC's).
 *
 * @param input.now - The moment to read.
 * @param input.timeZone - IANA zone, e.g. `America/Los_Angeles`; defaults to UTC.
 * @returns YYYY-MM-DD.
 */
export function todayDateOnly({ now = new Date(), timeZone = 'UTC' }: { now?: Date; timeZone?: string } = {}) {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
