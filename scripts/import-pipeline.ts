// Import the "Master Pipeline" tab of the fundraising spreadsheet.
//
//   npm run import:pipeline -- path/to/spreadsheet.xlsx [--dry-run]
//
// Safe to run again: existing funders are updated, and fields edited by hand in the dashboard are kept.
import { resolve } from 'node:path'
import { readSheet } from 'read-excel-file/node'
import { disconnectDatabase } from '#server/utils/db.ts'
import { importMasterPipeline } from '#server/utils/pipeline-import/import-master-pipeline.ts'
import type { SheetCell } from '#server/utils/pipeline-import/parse-master-pipeline.ts'
import { parseMasterPipeline } from '#server/utils/pipeline-import/parse-master-pipeline.ts'

const SHEET_NAME = 'Master Pipeline'

const args = process.argv.slice(2)
const filePath = args.find(arg => !arg.startsWith('--'))
const isDryRun = args.includes('--dry-run')

if (!filePath) {
    console.error('Usage: npm run import:pipeline -- path/to/spreadsheet.xlsx [--dry-run]')
    process.exit(1)
}

const rows = (await readSheet(resolve(filePath), SHEET_NAME)) as SheetCell[][]
const { funders, warnings } = parseMasterPipeline({ rows })
console.info(`[import] parsed ${funders.length} funders from "${SHEET_NAME}"`)
for (const warning of warnings) {
    console.info(`[import] note: ${warning}`)
}

if (isDryRun) {
    for (const funder of funders) {
        const amounts = funder.opportunities
            .map(opportunity => `${opportunity.goalType} ${opportunity.stage} ${(opportunity.amountCents ?? 0) / 100}`)
            .join('; ')
        console.info(`  ${funder.name} · ${funder.tier ?? '–'} · ${funder.contacts.length} contacts · ${amounts}`)
    }
    console.info('[import] dry run: nothing written')
} else {
    const summary = await importMasterPipeline({ funders, importedOn: new Date() })
    console.info(
        `[import] funders: ${summary.fundersCreated} created, ${summary.fundersUpdated} updated, ${summary.fundersUnchanged} unchanged`,
    )
    console.info(
        `[import] contacts added: ${summary.contactsAdded}; opportunities: ${summary.opportunitiesCreated} created, ${summary.opportunitiesUpdated} updated`,
    )
    for (const message of summary.skipped) {
        console.info(`[import] skipped: ${message}`)
    }
}
await disconnectDatabase()
