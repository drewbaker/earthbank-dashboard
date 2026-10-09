import { z } from 'zod'
import { FUNDER_KINDS, GOAL_TYPES, OPPORTUNITY_STAGES, RELATIONSHIP_STATUSES } from '#shared/constants/pipeline.ts'

// What the AI returns for one email. Kept to simple JSON Schema features (no min/max, no formats)
// so it works with structured outputs; values are range-checked after parsing.
export const EmailClassification = z.object({
    is_relevant: z.boolean().describe('True when the email is about fundraising with this funder.'),
    is_sensitive: z
        .boolean()
        .describe('True when the email is mainly personal, HR, legal, medical or salary matters, not funding.'),
    summary: z.string().describe('One or two sentences, at most 300 characters, stating only the funding facts.'),
    reason: z.string().describe('Why the suggested changes follow from the email, for the team to review.'),
    confidence: z.number().describe('0 to 1: how sure you are about the suggested changes overall.'),
    last_contact_on: z
        .string()
        .nullable()
        .describe('YYYY-MM-DD the email was sent, if it is a real exchange with the funder.'),
    relationship_status: z
        .enum(RELATIONSHIP_STATUSES)
        .nullable()
        .describe('New relationship status, or null to leave it.'),
    opportunity_updates: z.array(
        z.object({
            opportunity_id: z.string().describe('Id of an existing opportunity from the context.'),
            stage: z.enum(OPPORTUNITY_STAGES).nullable(),
            amount_usd: z.number().nullable().describe('Whole US dollars, only when the email states an amount.'),
            expected_decision_on: z.string().nullable().describe('YYYY-MM-DD'),
            expected_receipt_on: z.string().nullable().describe('YYYY-MM-DD when the money is expected to land.'),
            next_step: z.string().nullable().describe('Short next action for Earth Bank, if the email implies one.'),
            confidence: z.number().describe('0 to 1 for this opportunity update.'),
            reason: z.string(),
        }),
    ),
    new_contacts: z
        .array(z.object({ name: z.string(), email: z.string(), title: z.string().nullable() }))
        .describe('People at the funder who appear in the email and are not in the known contacts.'),
})
export type EmailClassification = z.infer<typeof EmailClassification>

// A proposal for a funder the team doesn't track yet, from a forwarded intro email.
export const DraftFunderProposal = z.object({
    is_funder: z
        .boolean()
        .describe('True only when the sender represents an organization or person that might fund Earth Bank.'),
    organization_name: z.string(),
    kind: z.enum(FUNDER_KINDS),
    contact_name: z.string(),
    contact_title: z.string().nullable(),
    goal_type: z.enum(GOAL_TYPES).describe('Which Earth Bank goal the conversation is most likely about.'),
    amount_usd: z.number().nullable(),
    summary: z.string().describe('At most 300 characters, funding facts only.'),
    next_step: z.string().nullable(),
})
export type DraftFunderProposal = z.infer<typeof DraftFunderProposal>
