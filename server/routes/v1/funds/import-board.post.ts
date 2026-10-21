import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { importBoardFunds, readBoardFunds } from '#server/utils/funds/import-board.ts'
import { ImportFundBoardRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Import the old fund board',
        description:
            "Adds the funds in the old Airtable board's JSON export (`{ records: [{ id, fields }] }`) and queues their research. Funds already on the list only get what they're missing; nothing a person entered is replaced, and no fund is added twice. Safe to run again.",
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ImportFundBoardRequest' } } },
        },
        responses: {
            200: {
                description: 'What happened to each fund',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundBoardImportResult' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: ImportFundBoardRequest })
    const result = await importBoardFunds({
        funds: readBoardFunds({ records: body.records }),
        importedById: ctx.user.id,
        now: new Date(),
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'fund.board_imported',
        entityType: 'fund',
        entityId: 'board_import',
        changes: {
            added: result.added,
            updated: result.updated,
            unchanged: result.unchanged,
            left_archived: result.left_archived,
            skipped: result.skipped,
        },
        ip: requestIp({ event }),
    })
    return result
})
