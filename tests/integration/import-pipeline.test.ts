// Covers the spreadsheet import against a real database: creating everything once, re-running
// without duplicates, and never overwriting a field someone edited in the dashboard.
import { afterAll, describe, expect, it } from 'vitest'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'
import type { ParsedFunder } from '#server/utils/pipeline-import/parse-master-pipeline.ts'

const { cleanupTestDatabase } = setupTestDatabase()

afterAll(async () => {
    await cleanupTestDatabase()
})

const PARSED_FUNDERS: ParsedFunder[] = [
    {
        name: 'Shell Foundation',
        nameKey: 'shell foundation',
        kind: 'foundation',
        tier: 't1',
        relationshipStatus: 'advanced',
        geoFocus: 'Africa',
        potentialSize: 'Above $10M',
        materialsSent: true,
        lastContactAt: '2026-07-10',
        lastContactNote: 'Jul 10, 2026 (email re: dataroom)',
        notes: 'Taking it to Investment Committee.',
        contacts: [
            { name: 'Nick Jones', title: null, email: 'nicholas.jones@shellfoundation.org', notes: null },
            { name: 'Gmail Person', title: null, email: 'someone@gmail.com', notes: null },
        ],
        opportunities: [
            {
                goalType: 'design_grant',
                stage: 'due_diligence',
                amountCents: 50_000_000,
                nextStep: 'Await IC decision.',
            },
            { goalType: 'lending_capital', stage: 'identified', amountCents: 2_000_000_000, nextStep: null },
        ],
        sheetRows: [10],
    },
]

describe('importMasterPipeline', () => {
    it('creates funders, contacts, domains and opportunities', async () => {
        const { importMasterPipeline } = await import('#server/utils/pipeline-import/import-master-pipeline.ts')
        const { loadFunderDetail } = await import('#server/utils/funders.ts')
        const { findFunderByNameKey } = await import('#server/database/funders.ts')

        const summary = await importMasterPipeline({ funders: PARSED_FUNDERS, importedOn: new Date('2026-08-06') })
        expect(summary).toMatchObject({ fundersCreated: 1, contactsAdded: 2, opportunitiesCreated: 2 })

        const funder = await loadFunderDetail({
            funderId: (await findFunderByNameKey({ nameKey: 'shell foundation' }))!.id,
        })
        expect(funder).toMatchObject({
            tier: 't1',
            relationship_status: 'advanced',
            last_contact_at: '2026-07-10',
            materials_sent_at: '2026-08-06',
            // gmail.com is a personal mailbox, never a funder domain.
            email_domains: ['shellfoundation.org'],
        })
        expect(funder.opportunities.map(opportunity => [opportunity.goal_type, opportunity.amount_cents])).toEqual([
            ['design_grant', 50_000_000],
            ['lending_capital', 2_000_000_000],
        ])
    })

    it('changes nothing when run again', async () => {
        const { importMasterPipeline } = await import('#server/utils/pipeline-import/import-master-pipeline.ts')
        const summary = await importMasterPipeline({ funders: PARSED_FUNDERS, importedOn: new Date('2026-08-07') })
        expect(summary).toMatchObject({
            fundersCreated: 0,
            fundersUpdated: 0,
            fundersUnchanged: 1,
            contactsAdded: 0,
            opportunitiesCreated: 0,
            opportunitiesUpdated: 0,
        })
    })

    it('keeps fields edited by hand and updates the rest', async () => {
        const { importMasterPipeline } = await import('#server/utils/pipeline-import/import-master-pipeline.ts')
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const { findFunderByNameKey } = await import('#server/database/funders.ts')
        const funderId = (await findFunderByNameKey({ nameKey: 'shell foundation' }))!.id
        await applyFieldChanges({ entityType: 'funder', entityId: funderId, changes: { tier: 't2' }, source: 'manual' })

        const updatedSheet = [{ ...PARSED_FUNDERS[0]!, tier: 't1' as const, geoFocus: 'Africa, India' }]
        await importMasterPipeline({ funders: updatedSheet, importedOn: new Date('2026-08-08') })

        const funder = await findFunderByNameKey({ nameKey: 'shell foundation' })
        expect(funder).toMatchObject({ tier: 't2', geo_focus: 'Africa, India' })
    })
})
