import type { Contact as ContactRow } from '#server/generated/prisma/client.ts'
import type { FunderSummaryRow } from '#server/database/funders.ts'
import type { OpportunityRow } from '#server/database/opportunities.ts'
import { config } from '#server/utils/config.ts'
import { centsToNumber, toDateOnly, toIsoDateTime } from '#server/utils/dates.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import { serializeContact } from '#server/utils/serializers/contacts.ts'
import { serializeOpportunity } from '#server/utils/serializers/opportunities.ts'
import type {
    FunderKind,
    FunderStatus,
    FunderTier,
    GoalType,
    OpportunityStage,
    RelationshipStatus,
} from '#shared/constants/pipeline.ts'
import { GOAL_TYPES, OPPORTUNITY_STAGE_DETAILS } from '#shared/constants/pipeline.ts'
import type { Funder, FunderDetail } from '#shared/schemas/index.ts'
import { emailDomain } from '#shared/utils/email-addresses.ts'
import type { StageProbabilities } from '#shared/utils/probability.ts'
import { opportunityProbability, weightedAmountCents } from '#shared/utils/probability.ts'

/**
 * Public shape of a funder, with opportunity totals and the goals it's in play for.
 *
 * @param input.funder - The funder with owner and live opportunities.
 * @param input.stageProbabilities - The team's probability per stage.
 * @returns The API representation.
 */
export function serializeFunder({
    funder,
    stageProbabilities,
}: {
    funder: FunderSummaryRow
    stageProbabilities: StageProbabilities
}): Funder {
    const totals = {
        opportunity_count: 0,
        open_amount_cents: 0,
        weighted_amount_cents: 0,
        committed_amount_cents: 0,
        received_amount_cents: 0,
    }
    const goalTypes = new Set<GoalType>()
    for (const opportunity of funder.opportunities) {
        const stage = opportunity.stage as OpportunityStage
        const amountCents = centsToNumber({ cents: opportunity.amount_cents }) ?? 0
        totals.opportunity_count++
        if (stage !== 'lost') {
            goalTypes.add(opportunity.goal.type as GoalType)
        }
        if (OPPORTUNITY_STAGE_DETAILS[stage].isOpen) {
            const probability = opportunityProbability({
                stage,
                probabilityOverride: opportunity.probability_override,
                stageProbabilities,
            })
            totals.open_amount_cents += amountCents
            totals.weighted_amount_cents += weightedAmountCents({ amountCents, probability })
        } else if (stage === 'committed') {
            totals.committed_amount_cents += amountCents
        } else if (stage === 'received') {
            totals.received_amount_cents += amountCents
        }
    }
    return {
        id: funder.id,
        name: funder.name,
        kind: funder.kind as FunderKind,
        tier: funder.tier as FunderTier | null,
        relationship_status: funder.relationship_status as RelationshipStatus,
        geo_focus: funder.geo_focus,
        potential_size: funder.potential_size,
        email_domains: Array.isArray(funder.email_domains) ? (funder.email_domains as string[]) : [],
        materials_sent_at: toDateOnly({ date: funder.materials_sent_at }),
        last_contact_at: toDateOnly({ date: funder.last_contact_at }),
        last_contact_note: funder.last_contact_note,
        awaiting_reply_since: awaitingReplySince({ latestEmail: funder.emails[0] ?? null }),
        notes: funder.notes,
        owner: serializeUserSummary({ user: funder.owner }),
        status: funder.status as FunderStatus,
        goal_types: GOAL_TYPES.filter(type => goalTypes.has(type)),
        totals,
        archived_at: toIsoDateTime({ date: funder.archived_at }),
        created_at: funder.created_at.toISOString(),
        updated_at: funder.updated_at.toISOString(),
    }
}

/**
 * A funder with its contacts and full opportunities.
 *
 * @param input.funder - The funder with owner and live opportunities.
 * @param input.contacts - Its live contacts.
 * @param input.opportunities - Its opportunities with relations.
 * @param input.stageProbabilities - The team's probability per stage.
 * @returns The API representation.
 */
export function serializeFunderDetail({
    funder,
    contacts,
    opportunities,
    stageProbabilities,
}: {
    funder: FunderSummaryRow
    contacts: ContactRow[]
    opportunities: OpportunityRow[]
    stageProbabilities: StageProbabilities
}): FunderDetail {
    return {
        ...serializeFunder({ funder, stageProbabilities }),
        contacts: contacts.map(contact => serializeContact({ contact })),
        opportunities: opportunities.map(opportunity => serializeOpportunity({ opportunity, stageProbabilities })),
    }
}

/**
 * When the funder's latest email is from them (not from Earth Bank), the ball is in our court.
 *
 * @param input.latestEmail - The latest relevant email with this funder, if any.
 * @returns When they wrote, or null when we sent the last email (or there is none).
 */
function awaitingReplySince({ latestEmail }: { latestEmail: { from_address: string; sent_at: Date } | null }) {
    if (!latestEmail || config.internalEmailDomains.includes(emailDomain({ email: latestEmail.from_address }))) {
        return null
    }
    return toIsoDateTime({ date: latestEmail.sent_at })
}
