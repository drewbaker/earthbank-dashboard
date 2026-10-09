import { defineEventHandler, getRequestHost, sendRedirect } from 'h3'
import { config } from '#server/utils/config.ts'

// One public hostname. Other hosts (e.g. *.onrender.com) redirect to APP_URL, except the health check,
// which Render calls on its own hostname.
export default defineEventHandler(event => {
    if (!config.isProduction || event.path === '/healthz') {
        return
    }
    const canonicalHost = new URL(config.appUrl).host
    if (getRequestHost(event, { xForwardedHost: true }) !== canonicalHost) {
        return sendRedirect(event, `${config.appUrl}${event.path}`, 301)
    }
})
