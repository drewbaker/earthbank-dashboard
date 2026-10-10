import type { OpportunityStage } from '#shared/constants/pipeline.ts'
import type { Opportunity } from '#shared/schemas/index.ts'

/** One ask on the coverage map. The share page uses it too, so it carries only what the map shows. */
export type CoverageAsk = {
    key: string
    organization: string
    stage: OpportunityStage
    amount_cents: number | null
    /** Countries, regions or "global". */
    focus_areas: string[]
}

/**
 * Map rows for the team's own Pipeline page.
 *
 * @param input.opportunities - The tab's asks.
 * @returns Coverage map rows.
 */
export function coverageAsksFromOpportunities({ opportunities }: { opportunities: Opportunity[] }): CoverageAsk[] {
    return opportunities.map(opportunity => ({
        key: opportunity.id,
        organization: opportunity.funder.name,
        stage: opportunity.stage,
        amount_cents: opportunity.amount_cents,
        focus_areas: opportunity.focus_areas,
    }))
}
