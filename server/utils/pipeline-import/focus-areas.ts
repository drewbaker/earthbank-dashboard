import { hasFieldChangeEvents } from '#server/database/change-events.ts'
import { listOpportunitiesWithFunderGeoFocus } from '#server/database/opportunities.ts'
import { applyFieldChanges } from '#server/utils/change-events.ts'
import { focusCodesFromText } from '#shared/utils/geo-focus.ts'

/**
 * Give opportunities the geographic focus from their funder's spreadsheet "Geo Focus" column
 * ("Africa, India" → Africa + India), so the coverage map works without anyone re-entering it.
 *
 * Only opportunities whose focus has never been set or changed are filled, so it's safe to run on
 * every import and at boot, and never overrides (or refills) a focus someone chose.
 *
 * @param input.funderId - Only this funder's opportunities (all when omitted).
 * @returns How many opportunities were filled.
 */
export async function fillFocusAreasFromGeoFocus({ funderId }: { funderId?: string } = {}) {
    let filled = 0
    for (const opportunity of await listOpportunitiesWithFunderGeoFocus({ funderId })) {
        const current = Array.isArray(opportunity.focus_areas) ? opportunity.focus_areas : []
        if (current.length > 0) {
            continue
        }
        if (await hasFieldChangeEvents({ entityType: 'opportunity', entityId: opportunity.id, field: 'focus_areas' })) {
            continue
        }
        const { codes } = focusCodesFromText({ text: opportunity.funder.geo_focus })
        if (codes.length === 0) {
            continue
        }
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunity.id,
            changes: { focus_areas: codes },
            source: 'import',
            reason: `From the spreadsheet's Geo Focus: "${opportunity.funder.geo_focus}"`,
        })
        filled++
    }
    return filled
}
