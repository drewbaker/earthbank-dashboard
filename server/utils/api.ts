import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { defineEventHandler, getHeader, getQuery, isError, readBody, setResponseHeader, setResponseStatus } from 'h3'
import { ZodError } from 'zod'
import type { z } from 'zod'
import { ApiError } from '#server/utils/errors.ts'

/**
 * Define a `/v1` handler: no-store caching and the standard error shape for every failure.
 *
 * @param handler - The route's h3 handler.
 * @returns An h3 event handler.
 */
export function defineApiHandler<T>(handler: (event: H3Event<EventHandlerRequest>) => T | Promise<T>): EventHandler {
    return defineEventHandler(async event => {
        setResponseHeader(event, 'cache-control', 'private, no-store')
        try {
            return await handler(event)
        } catch (error) {
            return renderApiError({ event, error })
        }
    })
}

/**
 * Turn any thrown value into `{ error: { code, message, details? } }` with the right status.
 *
 * @param input.event - The request being answered.
 * @param input.error - Whatever was thrown.
 * @returns The JSON error body.
 */
export function renderApiError({ event, error }: { event: H3Event; error: unknown }) {
    if (error instanceof ApiError) {
        setResponseStatus(event, error.status)
        return { error: { code: error.code, message: error.message, details: error.details } }
    }
    if (error instanceof ZodError) {
        setResponseStatus(event, 422)
        return {
            error: {
                code: 'validation_error',
                message: error.issues[0]?.message ?? 'Invalid request.',
                details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
            },
        }
    }
    if (isError(error) && error.statusCode >= 400 && error.statusCode < 500) {
        setResponseStatus(event, error.statusCode)
        return { error: { code: 'request_error', message: error.statusMessage ?? error.message } }
    }
    console.error('[api] request failed', event.method, event.path, error)
    setResponseStatus(event, 500)
    return { error: { code: 'internal_error', message: 'Something went wrong.' } }
}

/**
 * Read and validate the JSON body.
 *
 * @param input.event - The request.
 * @param input.schema - zod schema the body must match.
 * @returns The parsed body.
 * @throws ZodError when the body doesn't match (rendered as 422).
 */
export async function parseBody<Schema extends z.ZodType>({ event, schema }: { event: H3Event; schema: Schema }) {
    const body = await readBody(event)
    return schema.parse(body ?? {}) as z.output<Schema>
}

/**
 * Read and validate the query string.
 *
 * @param input.event - The request.
 * @param input.schema - zod schema the query must match.
 * @returns The parsed query.
 * @throws ZodError when the query doesn't match (rendered as 422).
 */
export function parseQuery<Schema extends z.ZodType>({ event, schema }: { event: H3Event; schema: Schema }) {
    return schema.parse(getQuery(event)) as z.output<Schema>
}

/**
 * The caller's IP: the right-most `X-Forwarded-For` entry, which Render's proxy added.
 *
 * @param input.event - The request.
 * @returns The IP address, or null when unknown.
 */
export function requestIp({ event }: { event: H3Event }) {
    const forwardedFor = getHeader(event, 'x-forwarded-for')
    if (forwardedFor) {
        const entries = forwardedFor
            .split(',')
            .map(entry => entry.trim())
            .filter(Boolean)
        return entries.at(-1) ?? null
    }
    return event.node.req.socket.remoteAddress ?? null
}
