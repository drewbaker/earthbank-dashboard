import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { loadFunderDetail } from '#server/utils/funders.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funders'],
        summary: 'Get a funder',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The funder with contacts and opportunities',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FunderDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    return loadFunderDetail({ funderId: getRouterParam(event, 'id') ?? '' })
})
