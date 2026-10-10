import { APPROVAL_TO_FUNDING_DAYS, COMMITTEE_MIN_PROBABILITY } from '#shared/constants/pipeline.ts'

// Plain-language explanations of the dashboard's terms and assumptions, shown on hover next to the
// term (TermHint) and in table headers. One place, so every page explains a term the same way.
export const GLOSSARY = {
    weighted_pipeline: `Each open ask's amount times its chance of coming through, added up. The chance is set for each stage unless the ask has its own, and at least ${COMMITTEE_MIN_PROBABILITY}% once it's in committee. A realistic estimate, not a promise.`,
    weighted: `The ask's amount times its chance of coming through (shown as %): the stage's probability unless the ask has its own, and at least ${COMMITTEE_MIN_PROBABILITY}% in committee.`,
    secured: 'Money from approved and received asks.',
    open_asks: 'The full amount of every ask still in play: not yet approved, received or declined.',
    expected: `When the money is expected to land. An approved ask without a date is assumed to pay ${APPROVAL_TO_FUNDING_DAYS} days after approval.`,
    cash_on_hand:
        'The latest balance across the bank accounts synced from Bookeeping.ai, or the amount entered in Settings → Cash.',
    monthly_burn:
        'Average monthly operating spend over recent months, from the synced bank transactions (transfers and excluded categories left out), or the override in Settings → Cash.',
    runway_committed:
        'How long cash lasts at the monthly burn, counting only cash on hand and money from approved or received asks, on the dates it is expected to land. Planned expenses are included.',
    runway_weighted:
        'How long cash lasts if the open pipeline lands as weighted: each ask counts at its amount times its chance of coming through, on its expected date. Planned expenses are included.',
    committed_money_only: 'Cash on hand plus money from approved and received asks, minus burn and planned expenses.',
    out_of_cash: 'The month the cash line drops below $0.',
    global_focus: 'Asks focused on the whole world. They cover every country, so they are counted on their own.',
} as const

export type GlossaryTerm = keyof typeof GLOSSARY
