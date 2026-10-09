import { z } from 'zod'

export const ErrorResponse = z
    .object({
        error: z.object({
            code: z.string(),
            message: z.string(),
            details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
        }),
    })
    .meta({ id: 'ErrorResponse' })
export type ErrorResponse = z.infer<typeof ErrorResponse>

/**
 * The paginated list envelope used by every list endpoint.
 *
 * @param item - Schema of one list item.
 * @returns `{ data, next_cursor, has_more }`.
 */
export function listOf<Item extends z.ZodType>(item: Item) {
    return z.object({
        data: z.array(item),
        next_cursor: z.string().nullable(),
        has_more: z.boolean(),
    })
}

export const IsoDateTime = z.iso.datetime()

// Calendar dates (expected receipt, target date, last contact) travel as YYYY-MM-DD. Requests also
// accept a full ISO timestamp and keep its date part.
export const DateOnly = z.iso.date()
export const DateOnlyInput = z
    .union([z.iso.date(), z.iso.datetime({ offset: true })])
    .transform(value => value.slice(0, 10))

// Whole cents; lending-capital amounts can exceed 32-bit integers, so only the JS safe-integer limit applies.
export const Cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const UserSummary = z.object({
    id: z.string(),
    name: z.string(),
    avatar_url: z.string().nullable(),
})
export type UserSummary = z.infer<typeof UserSummary>

export const CursorQuery = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
})

/**
 * Parse a query-string boolean (`true`, `1`, `false`, `0`).
 *
 * @returns A zod schema producing a boolean, defaulting to false.
 */
export function queryBoolean() {
    return z
        .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
        .transform(value => value === true || value === 'true' || value === '1')
        .default(false)
}
