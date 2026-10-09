import type { H3Event } from 'h3'
import { proxyRequest } from 'h3'
import { config } from '#server/utils/config.ts'

/**
 * Proxy a request to the Sidequest dashboard (its own port, basic auth) behind our session.
 *
 * `10.auth.ts` has already redirected signed-out visitors to /login before this runs.
 *
 * @param input.event - The incoming `/admin/jobs…` request.
 * @returns The proxied response.
 */
export function proxyJobsDashboard({ event }: { event: H3Event }) {
    const credentials = Buffer.from(`${config.sidequestDashboardUser}:${config.sidequestDashboardPassword}`).toString(
        'base64',
    )
    return proxyRequest(event, `http://127.0.0.1:${config.sidequestDashboardPort}${event.path}`, {
        headers: { authorization: `Basic ${credentials}` },
    })
}
