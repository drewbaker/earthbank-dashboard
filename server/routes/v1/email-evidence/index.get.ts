import { getQuery } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { listFunderEmailEvidence } from '#server/database/email-evidence.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { badRequest } from '#server/utils/errors.ts'
import { serializeEmailEvidence } from '#server/utils/serializers/email-evidence.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Email'],
        summary: "A funder's emails",
        description:
            'What the dashboard learned from each email with a funder (summaries only; bodies are never stored).',
        parameters: [{ name: 'funder_id', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'Emails, newest first',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/EmailEvidenceList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const funderId = getQuery(event).funder_id
    if (typeof funderId !== 'string' || !funderId) {
        throw badRequest({ message: 'funder_id is required.' })
    }
    const rows = await listFunderEmailEvidence({ funderId, limit: 50 })
    return { data: rows.map(evidence => serializeEmailEvidence({ evidence })), next_cursor: null, has_more: false }
})
