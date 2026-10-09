import { getQuery, readMultipartFormData } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { readSheet } from 'read-excel-file/node'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { badRequest } from '#server/utils/errors.ts'
import { importMasterPipeline } from '#server/utils/pipeline-import/import-master-pipeline.ts'
import type { SheetCell } from '#server/utils/pipeline-import/parse-master-pipeline.ts'
import { parseMasterPipeline } from '#server/utils/pipeline-import/parse-master-pipeline.ts'

const SHEET_NAME = 'Master Pipeline'

defineRouteMeta({
    openAPI: {
        tags: ['Pipeline'],
        summary: 'Import the fundraising spreadsheet',
        description:
            'multipart/form-data with one `file` field: the .xlsx with a "Master Pipeline" tab. With `dry_run=true` nothing is written and the parsed funders are returned (PipelineImportPreview); otherwise the import runs (PipelineImportResult). Safe to repeat: existing funders are updated, and fields edited in the dashboard are kept.',
        parameters: [{ name: 'dry_run', in: 'query', schema: { type: 'boolean' } }],
        requestBody: {
            required: true,
            content: {
                'multipart/form-data': {
                    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
                },
            },
        },
        responses: {
            200: {
                description: 'Preview (dry run) or import result',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/PipelineImportResponse' } },
                },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const isDryRun = getQuery(event).dry_run === 'true'
    const parts = (await readMultipartFormData(event)) ?? []
    const file = parts.find(part => part.name === 'file' && part.filename)
    if (!file) {
        throw badRequest({ message: 'Choose the spreadsheet (.xlsx) to import.', code: 'missing_file' })
    }
    const rows = await readMasterPipelineRows({ data: file.data })
    const { funders, warnings } = parseMasterPipeline({ rows })
    if (isDryRun) {
        return {
            funders: funders.map(funder => ({
                name: funder.name,
                tier: funder.tier,
                contact_count: funder.contacts.length,
                opportunities: funder.opportunities.map(opportunity => ({
                    goal_type: opportunity.goalType,
                    stage: opportunity.stage,
                    amount_cents: opportunity.amountCents,
                })),
            })),
            warnings,
        }
    }
    const summary = await importMasterPipeline({ funders, importedOn: new Date() })
    await recordAudit({
        actor: ctx.actor,
        action: 'pipeline.imported',
        entityType: 'pipeline',
        entityId: 'master_pipeline',
        changes: {
            funders_created: summary.fundersCreated,
            funders_updated: summary.fundersUpdated,
            opportunities_created: summary.opportunitiesCreated,
        },
        ip: requestIp({ event }),
    })
    return {
        funders_created: summary.fundersCreated,
        funders_updated: summary.fundersUpdated,
        funders_unchanged: summary.fundersUnchanged,
        contacts_added: summary.contactsAdded,
        opportunities_created: summary.opportunitiesCreated,
        opportunities_updated: summary.opportunitiesUpdated,
        skipped: summary.skipped,
        warnings,
    }
})

/**
 * The rows of the "Master Pipeline" tab.
 *
 * @param input.data - The uploaded .xlsx.
 * @returns Rows of cells.
 * @throws ApiError 400 when the file isn't a spreadsheet or has no such tab.
 */
async function readMasterPipelineRows({ data }: { data: Buffer }) {
    try {
        return (await readSheet(data, SHEET_NAME)) as SheetCell[][]
    } catch {
        throw badRequest({
            message: `Upload the .xlsx export of the fundraising spreadsheet, with a "${SHEET_NAME}" tab.`,
            code: 'invalid_spreadsheet',
        })
    }
}
