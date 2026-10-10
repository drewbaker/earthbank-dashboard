import type { OpportunityStage } from '#shared/constants/pipeline.ts'
import type { Opportunity } from '#shared/schemas/index.ts'

/** One ask on the stage chart. The funder-facing share page uses it too, so it carries only what's shown. */
export type StageAsk = {
    key: string
    /** Funder name, with the ask's name when one funder has several. */
    label: string
    /** Funder name alone, for the "Amount TBD" line. */
    organization: string
    stage: OpportunityStage
    amount_cents: number | null
    /** Where the name links to (the funder page); none on the share page. */
    url?: string
}

/**
 * Chart rows for the team's own Pipeline page, linking to each funder.
 *
 * @param input.opportunities - The tab's asks.
 * @returns Stage chart rows.
 */
export function stageAsksFromOpportunities({ opportunities }: { opportunities: Opportunity[] }): StageAsk[] {
    const asksPerFunder = new Map<string, number>()
    for (const opportunity of opportunities) {
        if (opportunity.stage !== 'lost') {
            asksPerFunder.set(opportunity.funder.id, (asksPerFunder.get(opportunity.funder.id) ?? 0) + 1)
        }
    }
    return opportunities.map(opportunity => ({
        key: opportunity.id,
        label:
            (asksPerFunder.get(opportunity.funder.id) ?? 0) > 1
                ? `${opportunity.funder.name} · ${opportunity.name}`
                : opportunity.funder.name,
        organization: opportunity.funder.name,
        stage: opportunity.stage,
        amount_cents: opportunity.amount_cents,
        url: `/pipeline/funders/${opportunity.funder.id}`,
    }))
}
