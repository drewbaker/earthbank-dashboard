import { defineEventHandler, getRequestHeader } from 'h3'
import { renderApiError } from '#server/utils/api.ts'
import { config } from '#server/utils/config.ts'
import { forbidden } from '#server/utils/errors.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Every state-changing request must come from our own pages. The inbound-email webhook is exempt:
// it proves itself with a signature instead.
export default defineEventHandler(event => {
    if (SAFE_METHODS.has(event.method) || event.path.startsWith('/webhooks/')) {
        return
    }
    if (getRequestHeader(event, 'origin') !== new URL(config.appUrl).origin) {
        return renderApiError({
            event,
            error: forbidden({ message: 'Cross-origin request blocked.', code: 'csrf_rejected' }),
        })
    }
})
