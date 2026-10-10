import { defineEventHandler, setResponseHeaders } from 'h3'
import { config } from '#server/utils/config.ts'

export default defineEventHandler(event => {
    setResponseHeaders(event, {
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'x-frame-options': 'DENY',
        // Nothing here is for search engines, including the funder share pages.
        'x-robots-tag': 'noindex, nofollow',
        ...(config.isProduction ? { 'strict-transport-security': 'max-age=63072000; includeSubDomains' } : {}),
    })
    // Funder share pages: the secret is in the URL, so never cache them anywhere, never send the URL on
    // as a referrer, and keep them out of search engines and their caches entirely.
    if (event.path.startsWith('/share/') || event.path.startsWith('/v1/shared/')) {
        setResponseHeaders(event, {
            'cache-control': 'private, no-store, no-cache, must-revalidate, max-age=0',
            pragma: 'no-cache',
            expires: '0',
            'referrer-policy': 'no-referrer',
            'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
        })
    }
})
