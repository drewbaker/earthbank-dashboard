// Covers filling opportunities' geographic focus from the funder's spreadsheet "Geo Focus" text:
// filled once, logged as an import change, and never over a focus someone set or cleared.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

const { cleanupTestDatabase } = setupTestDatabase()

beforeAll(async () => {
    const { ensureDefaultGoals } = await import('#server/database/goals.ts')
    await ensureDefaultGoals()
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * A funder with one design grant opportunity.
 *
 * @param input.name - Funder name.
 * @param input.geoFocus - The sheet's Geo Focus text.
 * @returns The funder and opportunity ids.
 */
async function funderWithGeoFocus({ name, geoFocus }: { name: string; geoFocus: string | null }) {
    const { createFunderWithDetails, loadFunderDetail } = await import('#server/utils/funders.ts')
    const funderId = await createFunderWithDetails({
        name,
        geoFocus,
        opportunity: { goalType: 'design_grant', stage: 'identified', amountCents: null },
    })
    return { funderId, opportunityId: (await loadFunderDetail({ funderId })).opportunities[0]!.id }
}

describe('fillFocusAreasFromGeoFocus', () => {
    it('fills an empty focus from the sheet text, once', async () => {
        const { fillFocusAreasFromGeoFocus } = await import('#server/utils/pipeline-import/focus-areas.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        const { db } = await import('#server/utils/db.ts')
        const { funderId, opportunityId } = await funderWithGeoFocus({ name: 'Mulago', geoFocus: 'Africa, India' })

        expect(await fillFocusAreasFromGeoFocus({ funderId })).toBe(1)
        expect((await findOpportunity({ opportunityId }))!.focus_areas).toEqual(['region:africa', 'IN'])
        const change = await db().changeEvent.findFirstOrThrow({
            where: { entity_id: opportunityId, field: 'focus_areas' },
        })
        expect(change).toMatchObject({ source: 'import', status: 'applied' })

        expect(await fillFocusAreasFromGeoFocus({ funderId })).toBe(0)
    })

    it('leaves a focus someone cleared alone', async () => {
        const { fillFocusAreasFromGeoFocus } = await import('#server/utils/pipeline-import/focus-areas.ts')
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        const { funderId, opportunityId } = await funderWithGeoFocus({ name: 'Ford', geoFocus: 'Global' })
        await fillFocusAreasFromGeoFocus({ funderId })
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { focus_areas: [] },
            source: 'manual',
        })

        expect(await fillFocusAreasFromGeoFocus({ funderId })).toBe(0)
        expect((await findOpportunity({ opportunityId }))!.focus_areas).toEqual([])
    })

    it('skips funders with no geo focus', async () => {
        const { fillFocusAreasFromGeoFocus } = await import('#server/utils/pipeline-import/focus-areas.ts')
        const { funderId } = await funderWithGeoFocus({ name: 'Anonymous', geoFocus: null })
        expect(await fillFocusAreasFromGeoFocus({ funderId })).toBe(0)
    })
})
