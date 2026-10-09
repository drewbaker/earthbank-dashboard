import { defineEventHandler, setResponseHeaders } from 'h3'
import { config } from '#server/utils/config.ts'

export default defineEventHandler(event => {
    setResponseHeaders(event, {
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'x-frame-options': 'DENY',
        ...(config.isProduction ? { 'strict-transport-security': 'max-age=63072000; includeSubDomains' } : {}),
    })
})
