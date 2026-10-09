import { listMilestoneRows } from '#server/database/milestones.ts'
import { listOpportunityRows } from '#server/database/opportunities.ts'
import { loadCashSummary } from '#server/utils/cash.ts'
import { readCashSettings } from '#server/utils/cash-settings.ts'
import { fromDateOnly, toDateOnly } from '#server/utils/dates.ts'
import { serializeOpportunity } from '#server/utils/serializers/opportunities.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'
import type { MilestoneKind } from '#shared/constants/pipeline.ts'
import type { ForecastInputs } from '#shared/schemas/forecast.ts'

/**
 * Gather the inputs for the runway projection: cash, burn, pipeline and milestones.
 *
 * @param input.today - Today's date (YYYY-MM-DD).
 * @returns The forecast inputs.
 */
export async function loadForecastInputs({ today }: { today: string }): Promise<ForecastInputs> {
    const [cash, settings, stageProbabilities, opportunities, milestones] = await Promise.all([
        loadCashSummary({ today }),
        readCashSettings(),
        readStageProbabilities(),
        listOpportunityRows({ includeClosed: true, includeArchived: false }),
        listMilestoneRows({ includeDone: false, dueAfter: fromDateOnly({ value: today })! }),
    ])
    return {
        today,
        starting_cash_cents: cash.balance_cents,
        monthly_burn_cents: cash.monthly_burn_cents,
        include_goal_types: settings.include_goal_types,
        opportunities: opportunities.map(row => {
            const opportunity = serializeOpportunity({ opportunity: row, stageProbabilities })
            return {
                id: opportunity.id,
                name: opportunity.name,
                funder_name: opportunity.funder.name,
                goal_type: opportunity.goal_type,
                stage: opportunity.stage,
                amount_cents: opportunity.amount_cents,
                expected_receipt_at: opportunity.expected_receipt_at,
                probability: opportunity.probability,
            }
        }),
        milestones: milestones.map(milestone => ({
            id: milestone.id,
            title: milestone.title,
            due_at: toDateOnly({ date: milestone.due_at })!,
            kind: milestone.kind as MilestoneKind,
        })),
    }
}
