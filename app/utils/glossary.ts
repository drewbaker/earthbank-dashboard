import { APPROVAL_TO_FUNDING_DAYS, COMMITTEE_MIN_PROBABILITY } from '#shared/constants/pipeline.ts'
import { CONTACT_OVERDUE_AFTER_DAYS, CONTACT_STALE_AFTER_DAYS } from '#shared/utils/contact-staleness.ts'

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
    last_contact: `Last email or call with the funder. Yellow after ${CONTACT_STALE_AFTER_DAYS} days, red after ${CONTACT_OVERDUE_AFTER_DAYS}.`,
    global_focus: 'Asks focused on the whole world, so counted on their own.',
    research_completeness: 'How much of the AI research profile is filled in, weighted toward size, lending and deals.',
    diligence_completeness: 'How many of the due diligence questions have an answer, from a person or the AI.',
    finding_confidence: "How sure the AI was. Findings below the confidence floor (Settings → Research) aren't kept.",
    working_capital_loans:
        'Largest known working-capital loan: from published deals, else the top of their check size.',
    fund_spider:
        'New lenders found from team work history, co-lenders and DFI lists wait as pending until someone approves them; then they are researched.',
    fund_screening:
        'Before a spider find reaches this list, the AI checks where and to whom it lends. Lenders limited to one town, county or state with no climate focus, or with no climate or impact focus at all, are archived with its reason. It learns from what the team approves and archives.',
    fund_approval:
        "Spider finds wait here so nobody pays to research a lender outside Earth Bank's focus (a local development corporation, say). Approve to add it to the list and research it; archive to drop it (it moves to Archived and the spider never adds it again).",
    ticket_fit:
        'Their check sizes against our $500K–$5M: Fits covers most of it, Partly overlaps it, Outside misses it.',
    research_sources:
        'Every fact links to the page it was read on. The AI quotes it; the app checks the quote is there.',
} as const

export type GlossaryTerm = keyof typeof GLOSSARY
