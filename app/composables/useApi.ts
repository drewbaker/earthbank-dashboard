import { useRequestFetch } from '#imports'

type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

type ApiRequest = {
    path: string
    method?: ApiMethod
    body?: unknown
    query?: Record<string, string | number | boolean | null | undefined>
}

/**
 * A fetcher bound to `/v1` that forwards the session cookie during SSR.
 *
 * Must be called during component setup (it captures the SSR request), then used anywhere.
 *
 * @returns `api({ path, method, body, query })`.
 */
export function useApi() {
    // Nuxt's typed-route inference doesn't help with a generic /v1 wrapper; responses are typed by callers.
    const requestFetch = useRequestFetch() as <T>(url: string, options: Record<string, unknown>) => Promise<T>

    /**
     * Call a `/v1` endpoint.
     *
     * @param input.path - Path below `/v1`, e.g. `/users`.
     * @param input.method - HTTP method; defaults to GET.
     * @param input.body - JSON body for writes.
     * @param input.query - Query string values; null and undefined are dropped.
     * @returns The parsed JSON response.
     */
    return function api<T>({ path, method = 'GET', body, query }: ApiRequest) {
        return requestFetch<T>(`/v1${path}`, { method, body, query })
    }
}

/**
 * Turn a thrown API error into a message for the user.
 *
 * @param input.error - Whatever the API call threw.
 * @param input.fallback - Message when the error has no usable message.
 * @returns The first validation detail, else the API message, else the fallback.
 */
export function apiErrorMessage({ error, fallback = 'Something went wrong.' }: { error: unknown; fallback?: string }) {
    const body = (error as { data?: { error?: { message?: string; details?: { message: string }[] } } })?.data?.error
    return body?.details?.[0]?.message ?? body?.message ?? fallback
}
