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
