export type ApiErrorDetail = { path: string; message: string }

/**
 * An error with an HTTP status and a semantic code, rendered as `{ error: { code, message, details? } }`.
 */
export class ApiError extends Error {
    readonly status: number
    readonly code: string
    readonly details?: ApiErrorDetail[]

    /**
     * @param input.status - HTTP status code.
     * @param input.code - Semantic snake_case code, e.g. `validation_error`.
     * @param input.message - Human-readable message.
     * @param input.details - Optional per-field details.
     */
    constructor({
        status,
        code,
        message,
        details,
    }: {
        status: number
        code: string
        message: string
        details?: ApiErrorDetail[]
    }) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.code = code
        this.details = details
    }
}

/**
 * 400: the request is malformed.
 *
 * @param input.message - What was wrong.
 * @param input.code - Semantic code; defaults to `bad_request`.
 * @returns The error to throw.
 */
export function badRequest({ message, code = 'bad_request' }: { message: string; code?: string }) {
    return new ApiError({ status: 400, code, message })
}

/**
 * 401: no valid session.
 *
 * @param input.message - Optional message.
 * @returns The error to throw.
 */
export function unauthorized({ message = 'Sign in to continue.' }: { message?: string } = {}) {
    return new ApiError({ status: 401, code: 'unauthorized', message })
}

/**
 * 403: signed in but not allowed.
 *
 * @param input.message - Optional message.
 * @param input.code - Semantic code; defaults to `forbidden`.
 * @returns The error to throw.
 */
export function forbidden({ message = 'You do not have access to this.', code = 'forbidden' } = {}) {
    return new ApiError({ status: 403, code, message })
}

/**
 * 404: the resource doesn't exist.
 *
 * @param input.resource - Resource name for the message, e.g. `Funder`.
 * @returns The error to throw.
 */
export function notFound({ resource = 'Resource' }: { resource?: string } = {}) {
    return new ApiError({ status: 404, code: 'not_found', message: `${resource} not found.` })
}

/**
 * 409: the request conflicts with existing data.
 *
 * @param input.message - What conflicted.
 * @returns The error to throw.
 */
export function conflict({ message }: { message: string }) {
    return new ApiError({ status: 409, code: 'conflict', message })
}

/**
 * 429: too many requests.
 *
 * @param input.message - Optional message.
 * @returns The error to throw.
 */
export function tooManyRequests({ message = 'Too many requests. Try again shortly.' } = {}) {
    return new ApiError({ status: 429, code: 'rate_limited', message })
}
