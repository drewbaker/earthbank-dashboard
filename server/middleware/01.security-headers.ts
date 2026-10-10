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
})
