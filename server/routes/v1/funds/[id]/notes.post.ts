import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { aiProvider } from '#server/utils/ai/provider.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { ApiError, badRequest } from '#server/utils/errors.ts'
import { loadFundDetail, requireFund } from '#server/utils/funds/fund-detail.ts'
import { importFundNote, readGoogleDocText } from '#server/utils/funds/import-note.ts'
import { requestTimeZone } from '#server/utils/time-zone.ts'
import { ImportFundNoteRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Import a note into a fund',
        description:
            'Reads call notes (pasted text, or a Google Doc link read with your Drive connection) and fills research fields, people and due diligence answers from what the note says, each quoted from it and credited "Note from {you} on {time}". A person\'s existing diligence answer is never replaced; the result lists those under kept_existing.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ImportFundNoteRequest' } } },
        },
        responses: {
            200: {
                description: 'The fund, with the new note first in imported_notes',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const fundManagerId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: ImportFundNoteRequest })
    const fund = await requireFund({ fundManagerId })
    if (fund.archived_at) {
        throw badRequest({ message: 'Restore the fund before importing notes into it.', code: 'fund_archived' })
    }
    const ai = aiProvider()
    if (!ai) {
        throw new ApiError({ status: 503, code: 'ai_not_configured', message: 'AI is not set up (no Anthropic key).' })
    }
    const docUrl = body.doc_url?.trim() || null
    const text = docUrl ? await readGoogleDocText({ docUrl, userId: ctx.user.id }) : (body.text ?? '')
    const note = await importFundNote({
        fundManagerId,
        fundName: fund.name,
        author: { id: ctx.user.id, name: ctx.user.name },
        text,
        docUrl,
        timeZone: requestTimeZone({ event }),
        ai,
        now: new Date(),
    })
    // The note's text isn't logged; only where it came from and what it changed.
    await recordAudit({
        actor: ctx.actor,
        action: 'fund.note_imported',
        entityType: 'fund',
        entityId: fundManagerId,
        changes: {
            note_id: note.id,
            origin: note.origin,
            findings_added: note.findings_added,
            diligence_answered: note.diligence_answered,
        },
        ip: requestIp({ event }),
    })
    return loadFundDetail({ fundManagerId })
})
