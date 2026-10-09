import { defineApiHandler } from '#server/utils/api.ts'
import { ApiError } from '#server/utils/errors.ts'

// Unknown /v1 paths get the JSON error shape instead of Nuxt's HTML 404 page.
export default defineApiHandler(event => {
    throw new ApiError({ status: 404, code: 'not_found', message: `No route for ${event.method} ${event.path}.` })
})
