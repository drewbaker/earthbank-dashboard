import { createContactRow, findContactByEmail, listFunderContacts } from '#server/database/contacts.ts'
import { createFunderRow, findFunderByNameKey, findFunderSummary } from '#server/database/funders.ts'
import { goalIdsByType } from '#server/database/goals.ts'
import { createOpportunityRow, listOpportunityRows } from '#server/database/opportunities.ts'
import { centsToBigInt, fromDateOnly } from '#server/utils/dates.ts'
import { conflict, notFound } from '#server/utils/errors.ts'
import { serializeFunderDetail } from '#server/utils/serializers/funders.ts'
import { readStageProbabilities } from '#server/utils/settings.ts'
import type {
    FunderKind,
    FunderStatus,
    FunderTier,
    GoalType,
    OpportunityStage,
    RelationshipStatus,
} from '#shared/constants/pipeline.ts'
import { GOAL_TYPE_DETAILS } from '#shared/constants/pipeline.ts'
import { normalizeEmailAddress, organizationDomains } from '#shared/utils/email-addresses.ts'
import { funderNameKey } from '#shared/utils/funder-names.ts'

export type NewContact = { name: string; title?: string | null; email?: string | null; notes?: string | null }

export type NewOpportunity = {
    goalType: GoalType
    name?: string
    stage: OpportunityStage
    amountCents?: number | null
    expectedReceiptAt?: string | null
}

/**
 * Create a funder with its first contacts and, optionally, a first opportunity.
 *
 * Used by the API, the spreadsheet importer and AI-drafted funders. Contact emails add their
 * organization domains to the funder automatically (free-mail domains excluded).
 *
 * @param input.name - Organization name; must not match an existing funder.
 * @param input.kind - Kind of organization.
 * @param input.tier - Priority tier.
 * @param input.relationshipStatus - Where the relationship stands.
 * @param input.geoFocus - Geographic focus.
 * @param input.potentialSize - Size bucket as written by the team.
 * @param input.emailDomains - Domains typed by the user (normalized).
 * @param input.notes - Free-text notes.
 * @param input.ownerId - Owning team member.
 * @param input.status - `active`, or `draft` for AI proposals.
 * @param input.contacts - First contacts.
 * @param input.opportunity - First opportunity, if any.
 * @returns The created funder's id.
 * @throws ApiError 409 when the name or a contact email is already taken.
 */
export async function createFunderWithDetails({
    name,
    kind = 'foundation',
    tier = null,
    relationshipStatus = 'no_contact',
    geoFocus = null,
    potentialSize = null,
    emailDomains = [],
    notes = null,
    ownerId = null,
    status = 'active',
    contacts = [],
    opportunity = null,
}: {
    name: string
    kind?: FunderKind
    tier?: FunderTier | null
    relationshipStatus?: RelationshipStatus
    geoFocus?: string | null
    potentialSize?: string | null
    emailDomains?: string[]
    notes?: string | null
    ownerId?: string | null
    status?: FunderStatus
    contacts?: NewContact[]
    opportunity?: NewOpportunity | null
}) {
    const nameKey = funderNameKey({ name })
    const existing = await findFunderByNameKey({ nameKey })
    if (existing) {
        throw conflict({ message: `${existing.name} is already in the pipeline.` })
    }

    const preparedContacts = await prepareContacts({ contacts })
    const contactDomains = organizationDomains({
        emails: preparedContacts.flatMap(contact => (contact.email ? [contact.email] : [])),
    })

    const funder = await createFunderRow({
        name: name.trim(),
        nameKey,
        kind,
        tier,
        relationshipStatus,
        geoFocus,
        potentialSize,
        emailDomains: [...new Set([...emailDomains, ...contactDomains])],
        notes,
        ownerId,
        status,
    })

    for (const contact of preparedContacts) {
        await createContactRow({ funderId: funder.id, ...contact })
    }

    if (opportunity) {
        const goalIds = await goalIdsByType()
        await createOpportunityRow({
            funderId: funder.id,
            goalId: goalIds.get(opportunity.goalType)!,
            name: opportunity.name ?? defaultOpportunityName({ goalType: opportunity.goalType }),
            stage: opportunity.stage,
            amountCents: centsToBigInt({ cents: opportunity.amountCents }),
            probabilityOverride: null,
            expectedDecisionAt: null,
            expectedReceiptAt: fromDateOnly({ value: opportunity.expectedReceiptAt }),
            receivedAt: null,
            nextStep: null,
            ownerId,
        })
    }
    return funder.id
}

/**
 * Load everything the funder page shows.
 *
 * @param input.funderId - The funder.
 * @returns The serialized funder with contacts and opportunities.
 * @throws ApiError 404 when the funder doesn't exist.
 */
export async function loadFunderDetail({ funderId }: { funderId: string }) {
    const funder = await findFunderSummary({ funderId })
    if (!funder) {
        throw notFound({ resource: 'Funder' })
    }
    const [contacts, opportunities, stageProbabilities] = await Promise.all([
        listFunderContacts({ funderId }),
        listOpportunityRows({ funderId, includeClosed: true, includeArchived: false }),
        readStageProbabilities(),
    ])
    return serializeFunderDetail({ funder, contacts, opportunities, stageProbabilities })
}

/**
 * Default opportunity name for a goal, e.g. "Design grant".
 *
 * @param input.goalType - The goal.
 * @returns A short name.
 */
export function defaultOpportunityName({ goalType }: { goalType: GoalType }) {
    return (
        { design_grant: 'Design grant', opex: 'OpEx funding', lending_capital: 'Lending capital' }[goalType] ??
        GOAL_TYPE_DETAILS[goalType].label
    )
}

/**
 * Normalize new contacts and make sure no email already belongs to another contact.
 *
 * @param input.contacts - Contacts as submitted.
 * @returns Contacts ready to insert.
 * @throws ApiError 409 when an email is already used.
 */
async function prepareContacts({ contacts }: { contacts: NewContact[] }) {
    const prepared = []
    const seenEmails = new Set<string>()
    for (const contact of contacts) {
        const email = contact.email ? normalizeEmailAddress({ email: contact.email }) : null
        if (email) {
            if (seenEmails.has(email) || (await findContactByEmail({ email }))) {
                throw conflict({ message: `${email} is already a contact.` })
            }
            seenEmails.add(email)
        }
        prepared.push({ name: contact.name.trim(), title: contact.title ?? null, email, notes: contact.notes ?? null })
    }
    return prepared
}
