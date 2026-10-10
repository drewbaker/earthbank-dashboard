import { APPROVAL_TO_FUNDING_DAYS, COMMITTEE_MIN_PROBABILITY } from '#shared/constants/pipeline.ts'

// Plain-language explanations of the dashboard's terms and assumptions, shown on hover next to the
// term (TermHint) and in table headers. One place, so every page explains a term the same way.
export const GLOSSARY = {
    weighted_pipeline: `Open asks × their chance of coming through (at least ${COMMITTEE_MIN_PROBABILITY}% in committee).`,
    weighted: `This ask × its chance of coming through (the %).`,
    secured: 'Money from approved and received asks.',
    open_asks: 'Every ask not yet approved, received or declined.',
    expected: `When the money should land. Approved with no date: ${APPROVAL_TO_FUNDING_DAYS} days later.`,
    cash_on_hand: 'Latest bank balance, from Bookeeping.ai or Settings.',
    monthly_burn: 'Average monthly operating spend over recent months.',
    runway_committed: 'How long cash lasts counting only approved and received money.',
    runway_weighted: 'How long cash lasts if open asks land at their weighted value.',
    committed_money_only: 'Cash plus approved and received money, minus burn.',
    out_of_cash: 'Where the cash line drops below $0.',
    global_focus: 'Asks focused on the whole world, so counted on their own.',
} as const

export type GlossaryTerm = keyof typeof GLOSSARY
