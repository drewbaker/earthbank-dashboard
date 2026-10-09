import type { ScenarioAdjustment } from '#shared/schemas/index.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'

export type AdjustmentKind = ScenarioAdjustment['kind']

export const ADJUSTMENT_KIND_DETAILS: Record<AdjustmentKind, { label: string; icon: string }> = {
    shift_receipt: { label: 'Funding date slips', icon: 'i-lucide-calendar-clock' },
    change_amount: { label: 'Funding amount changes', icon: 'i-lucide-circle-dollar-sign' },
    change_probability: { label: 'Probability changes', icon: 'i-lucide-percent' },
    exclude_opportunity: { label: "Funding doesn't come", icon: 'i-lucide-circle-slash' },
    add_recurring_cost: { label: 'New hire or monthly cost', icon: 'i-lucide-user-plus' },
    add_one_off: { label: 'One-off cost or income', icon: 'i-lucide-receipt' },
    change_burn_pct: { label: 'Burn changes by %', icon: 'i-lucide-trending-up' },
}

/**
 * One line describing an adjustment, e.g. "UBS Optimus · Design grant lands 3 months later".
 *
 * @param input.adjustment - The adjustment.
 * @param input.opportunityNames - Opportunity id → "Funder · Name".
 * @returns The description.
 */
export function describeAdjustment({
    adjustment,
    opportunityNames,
}: {
    adjustment: ScenarioAdjustment
    opportunityNames: Map<string, string>
}) {
    const opportunity =
        'opportunity_id' in adjustment
            ? (opportunityNames.get(adjustment.opportunity_id) ?? 'A removed opportunity')
            : ''
    switch (adjustment.kind) {
        case 'shift_receipt':
            return `${opportunity} lands ${Math.abs(adjustment.months)} month${Math.abs(adjustment.months) === 1 ? '' : 's'} ${adjustment.months >= 0 ? 'later' : 'earlier'}`
        case 'change_amount':
            return `${opportunity} becomes ${formatMoney({ cents: adjustment.amount_cents })}`
        case 'change_probability':
            return `${opportunity} at ${adjustment.probability}% likely`
        case 'exclude_opportunity':
            return `${opportunity} doesn't come`
        case 'add_recurring_cost':
            return `${adjustment.label}: ${formatMoney({ cents: adjustment.monthly_cents })}/month from ${formatDate({ value: adjustment.starts_at })}${adjustment.ends_at ? ` to ${formatDate({ value: adjustment.ends_at })}` : ''}`
        case 'add_one_off':
            return `${adjustment.label}: ${adjustment.amount_cents >= 0 ? '+' : '−'}${formatMoney({ cents: Math.abs(adjustment.amount_cents) })} on ${formatDate({ value: adjustment.at })}`
        case 'change_burn_pct':
            return `Burn ${adjustment.pct >= 0 ? 'up' : 'down'} ${Math.abs(adjustment.pct)}% from ${formatDate({ value: adjustment.starts_at })}`
    }
}
