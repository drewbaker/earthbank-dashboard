import { defineRouteMeta } from 'nitropack/runtime'
import { listActiveShareLinks } from '#server/database/share-links.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeShareLink } from '#server/utils/share-links.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Sharing'],
        summary: 'List share links',
        description: 'Password-protected links that show funders a summary of the pipeline.',
        responses: {
            200: {
                description: 'Active links',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ShareLinkList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const links = await listActiveShareLinks()
    return { data: links.map(link => serializeShareLink({ link })), next_cursor: null, has_more: false }
})
