import { getQuery } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { countFunderEmailEvidence, listFunderEmailEvidence } from '#server/database/email-evidence.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { badRequest } from '#server/utils/errors.ts'
import { serializeEmailEvidence } from '#server/utils/serializers/email-evidence.ts'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 500

defineRouteMeta({
    openAPI: {
        tags: ['Email'],
        summary: "A funder's emails",
        description:
            'What the dashboard learned from each email with a funder, newest first (summaries only; bodies are never stored). `total` is how many there are; `limit` (default 20, up to 500) caps how many are returned.',
        parameters: [
            { name: 'funder_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
            200: {
                description: 'Emails, newest first',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/EmailEvidenceList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const query = getQuery(event)
    const funderId = query.funder_id
    if (typeof funderId !== 'string' || !funderId) {
        throw badRequest({ message: 'funder_id is required.' })
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || DEFAULT_LIMIT))
    const [rows, total] = await Promise.all([
        listFunderEmailEvidence({ funderId, limit }),
        countFunderEmailEvidence({ funderId }),
    ])
    return {
        data: rows.map(evidence =>
            serializeEmailEvidence({ evidence, viewer: { id: ctx.user.id, email: ctx.user.email } }),
        ),
        next_cursor: null,
        has_more: total > rows.length,
        total,
    }
})
