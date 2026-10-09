import { z } from 'zod'
import {
    FUNDER_KINDS,
    FUNDER_STATUSES,
    FUNDER_TIERS,
    GOAL_TYPES,
    OPPORTUNITY_STAGES,
    RELATIONSHIP_STATUSES,
} from '#shared/constants/pipeline.ts'
import { normalizeDomain } from '#shared/utils/email-addresses.ts'
import {
    Cents,
    CursorQuery,
    DateOnly,
    DateOnlyInput,
    IsoDateTime,
    listOf,
    queryBoolean,
    UserSummary,
} from '#shared/schemas/common.ts'
import { Contact, CreateContactRequest } from '#shared/schemas/contacts.ts'
import { Opportunity } from '#shared/schemas/opportunities.ts'

export const FunderTotals = z.object({
    opportunity_count: z.number().int(),
    open_amount_cents: Cents,
    weighted_amount_cents: Cents,
    committed_amount_cents: Cents,
    received_amount_cents: Cents,
})

export const Funder = z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(FUNDER_KINDS),
    tier: z.enum(FUNDER_TIERS).nullable(),
    relationship_status: z.enum(RELATIONSHIP_STATUSES),
    geo_focus: z.string().nullable(),
    potential_size: z.string().nullable(),
    email_domains: z.array(z.string()),
    materials_sent_at: DateOnly.nullable(),
    last_contact_at: DateOnly.nullable(),
    last_contact_note: z.string().nullable(),
    /** When the funder's latest email is theirs (they're waiting on us), when they sent it. */
    awaiting_reply_since: IsoDateTime.nullable(),
    notes: z.string().nullable(),
    owner: UserSummary.nullable(),
    status: z.enum(FUNDER_STATUSES),
    goal_types: z.array(z.enum(GOAL_TYPES)),
    totals: FunderTotals,
    archived_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
})
export type Funder = z.infer<typeof Funder>

export const FunderDetail = Funder.extend({
    contacts: z.array(Contact),
    opportunities: z.array(Opportunity),
})
export type FunderDetail = z.infer<typeof FunderDetail>

export const FunderList = listOf(Funder)
export type FunderList = z.infer<typeof FunderList>

const EmailDomains = z
    .array(z.string())
    .max(20)
    .transform((domains, context) => {
        const normalized = domains.map(domain => normalizeDomain({ domain }))
        if (normalized.some(domain => domain === null)) {
            context.addIssue({ code: 'custom', message: 'Enter domains like ikeafoundation.org.' })
            return z.NEVER
        }
        return [...new Set(normalized as string[])]
    })

const FunderFields = {
    name: z.string().trim().min(1, 'Name is required.').max(200),
    kind: z.enum(FUNDER_KINDS),
    tier: z.enum(FUNDER_TIERS).nullable(),
    relationship_status: z.enum(RELATIONSHIP_STATUSES),
    geo_focus: z.string().trim().max(200).nullable(),
    potential_size: z.string().trim().max(200).nullable(),
    email_domains: EmailDomains,
    materials_sent_at: DateOnlyInput.nullable(),
    last_contact_at: DateOnlyInput.nullable(),
    last_contact_note: z.string().trim().max(500).nullable(),
    notes: z.string().trim().max(20000).nullable(),
    owner_id: z.string().nullable(),
}

export const CreateFunderRequest = z.object({
    name: FunderFields.name,
    kind: FunderFields.kind.default('foundation'),
    tier: FunderFields.tier.optional(),
    relationship_status: FunderFields.relationship_status.default('no_contact'),
    geo_focus: FunderFields.geo_focus.optional(),
    potential_size: FunderFields.potential_size.optional(),
    email_domains: EmailDomains.default([]),
    notes: FunderFields.notes.optional(),
    owner_id: FunderFields.owner_id.optional(),
    contacts: z.array(CreateContactRequest).max(20).default([]),
    opportunity: z
        .object({
            goal_type: z.enum(GOAL_TYPES),
            name: z.string().trim().min(1).max(200).optional(),
            stage: z.enum(OPPORTUNITY_STAGES).default('identified'),
            amount_cents: Cents.nullable().optional(),
            expected_receipt_at: DateOnlyInput.nullable().optional(),
        })
        .nullish(),
})
export type CreateFunderRequest = z.infer<typeof CreateFunderRequest>

export const UpdateFunderRequest = z.object(FunderFields).partial()
export type UpdateFunderRequest = z.infer<typeof UpdateFunderRequest>

export const ListFundersQuery = CursorQuery.extend({
    q: z.string().trim().max(200).optional(),
    tier: z.enum(FUNDER_TIERS).optional(),
    relationship_status: z.enum(RELATIONSHIP_STATUSES).optional(),
    goal_type: z.enum(GOAL_TYPES).optional(),
    owner_id: z.string().optional(),
    status: z.enum(FUNDER_STATUSES).optional(),
    include_archived: queryBoolean(),
})
