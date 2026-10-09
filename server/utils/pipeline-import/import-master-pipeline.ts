import { findContactByEmail, listFunderContacts } from '#server/database/contacts.ts'
import { latestNonImportChangeAt } from '#server/database/change-events.ts'
import { findFunder, findFunderByNameKey, updateFunderColumns } from '#server/database/funders.ts'
import { ensureDefaultGoals, goalIdsByType } from '#server/database/goals.ts'
import { createOpportunityRow, listOpportunityRows } from '#server/database/opportunities.ts'
import type { ChangeValue } from '#server/utils/change-events.ts'
import { applyFieldChanges } from '#server/utils/change-events.ts'
import { addContactToFunder } from '#server/utils/contacts.ts'
import { centsToBigInt, fromDateOnly, toDateOnly } from '#server/utils/dates.ts'
import { createFunderWithDetails, defaultOpportunityName } from '#server/utils/funders.ts'
import { fillFocusAreasFromGeoFocus } from '#server/utils/pipeline-import/focus-areas.ts'
import type {
    ParsedContact,
    ParsedFunder,
    ParsedOpportunity,
} from '#server/utils/pipeline-import/parse-master-pipeline.ts'
import { config } from '#server/utils/config.ts'
import type { ChangeEntityType } from '#shared/schemas/index.ts'
import { emailDomain } from '#shared/utils/email-addresses.ts'

export type PipelineImportSummary = {
    fundersCreated: number
    fundersUpdated: number
    fundersUnchanged: number
    contactsAdded: number
    opportunitiesCreated: number
    opportunitiesUpdated: number
    skipped: string[]
}

/**
 * Write parsed spreadsheet funders into the database. Safe to run again: funders are matched by
 * normalized name, contacts by email, opportunities by funder + goal, and any field someone has
 * edited by hand in the dashboard is left alone.
 *
 * @param input.funders - Output of `parseMasterPipeline`.
 * @param input.importedOn - Date recorded as "materials sent" for rows marked Y (the sheet has no date).
 * @returns Counts of what changed, and anything skipped.
 */
export async function importMasterPipeline({ funders, importedOn }: { funders: ParsedFunder[]; importedOn: Date }) {
    await ensureDefaultGoals()
    const goalIds = await goalIdsByType()
    const summary: PipelineImportSummary = {
        fundersCreated: 0,
        fundersUpdated: 0,
        fundersUnchanged: 0,
        contactsAdded: 0,
        opportunitiesCreated: 0,
        opportunitiesUpdated: 0,
        skipped: [],
    }

    for (const parsed of funders) {
        const existing = await findFunderByNameKey({ nameKey: parsed.nameKey })
        const funderId = existing ? existing.id : await createImportedFunder({ parsed, importedOn, summary })
        let changeCount = 0
        if (existing) {
            changeCount += await updateImportedFunder({ funderId, parsed, importedOn })
            changeCount += await addImportedContacts({ funderId, contacts: parsed.contacts, summary })
        }
        changeCount += await upsertImportedOpportunities({
            funderId,
            opportunities: parsed.opportunities,
            goalIds,
            summary,
        })
        changeCount += await fillFocusAreasFromGeoFocus({ funderId })
        if (existing) {
            summary[changeCount > 0 ? 'fundersUpdated' : 'fundersUnchanged']++
        }
    }
    return summary
}

/**
 * Create a funder that isn't in the database yet, with its contacts.
 *
 * @param input.parsed - The parsed funder.
 * @param input.importedOn - Date recorded for "materials sent".
 * @param input.summary - Counters to update.
 * @returns The new funder's id.
 */
async function createImportedFunder({
    parsed,
    importedOn,
    summary,
}: {
    parsed: ParsedFunder
    importedOn: Date
    summary: PipelineImportSummary
}) {
    const contacts = await withoutTakenEmails({ contacts: parsed.contacts, funderName: parsed.name, summary })
    const funderId = await createFunderWithDetails({
        name: parsed.name,
        kind: parsed.kind,
        tier: parsed.tier,
        relationshipStatus: parsed.relationshipStatus,
        geoFocus: parsed.geoFocus,
        potentialSize: parsed.potentialSize,
        notes: parsed.notes,
        contacts,
    })
    await updateFunderColumns({
        funderId,
        data: {
            materials_sent_at: parsed.materialsSent ? fromDateOnly({ value: toDateOnly({ date: importedOn }) }) : null,
            last_contact_at: fromDateOnly({ value: parsed.lastContactAt }),
            last_contact_note: parsed.lastContactNote,
        },
    })
    summary.fundersCreated++
    summary.contactsAdded += contacts.length
    return funderId
}

/**
 * Update an existing funder's sheet-owned fields, skipping anything edited by hand.
 *
 * @param input.funderId - The funder.
 * @param input.parsed - The parsed row.
 * @param input.importedOn - Date recorded for "materials sent".
 * @returns The number of fields changed.
 */
async function updateImportedFunder({
    funderId,
    parsed,
    importedOn,
}: {
    funderId: string
    parsed: ParsedFunder
    importedOn: Date
}) {
    const current = await findFunder({ funderId })
    const changes: Record<string, ChangeValue> = {
        tier: parsed.tier,
        relationship_status: parsed.relationshipStatus,
        geo_focus: parsed.geoFocus,
        potential_size: parsed.potentialSize,
        last_contact_note: parsed.lastContactNote,
        notes: parsed.notes,
    }
    // Only move "last contact" forward; the app may know about a more recent conversation.
    const currentLastContact = toDateOnly({ date: current?.last_contact_at })
    if (parsed.lastContactAt && (!currentLastContact || parsed.lastContactAt > currentLastContact)) {
        changes.last_contact_at = parsed.lastContactAt
    }
    if (parsed.materialsSent && !current?.materials_sent_at) {
        changes.materials_sent_at = toDateOnly({ date: importedOn })
    }
    const events = await applyFieldChanges({
        entityType: 'funder',
        entityId: funderId,
        changes: await withoutDashboardEdits({ entityType: 'funder', entityId: funderId, changes }),
        source: 'import',
        reason: 'Spreadsheet import',
    })
    return events.length
}

/**
 * Add contacts that aren't on the funder yet (by email, or by name when there's no email).
 *
 * @param input.funderId - The funder.
 * @param input.contacts - Parsed contacts.
 * @param input.summary - Counters to update.
 * @returns The number of contacts added.
 */
async function addImportedContacts({
    funderId,
    contacts,
    summary,
}: {
    funderId: string
    contacts: ParsedContact[]
    summary: PipelineImportSummary
}) {
    const known = await listFunderContacts({ funderId })
    let added = 0
    for (const contact of contacts) {
        if (contact.email && config.internalEmailDomains.includes(emailDomain({ email: contact.email }))) {
            summary.skipped.push(`${contact.email} is an Earth Bank address, not a funder contact.`)
            continue
        }
        if (contact.email) {
            const owner = await findContactByEmail({ email: contact.email })
            if (owner) {
                if (owner.funder_id !== funderId) {
                    summary.skipped.push(`${contact.email} already belongs to another funder's contact.`)
                }
                continue
            }
        } else if (known.some(person => person.name.toLowerCase() === contact.name.toLowerCase())) {
            continue
        }
        await addContactToFunder({ funderId, ...contact, source: 'import' })
        added++
    }
    summary.contactsAdded += added
    return added
}

/**
 * Create or update the funder's opportunity for each goal in the sheet.
 *
 * @param input.funderId - The funder.
 * @param input.opportunities - Parsed opportunities.
 * @param input.goalIds - Goal type → id.
 * @param input.summary - Counters to update.
 * @returns The number of opportunities created or changed.
 */
async function upsertImportedOpportunities({
    funderId,
    opportunities,
    goalIds,
    summary,
}: {
    funderId: string
    opportunities: ParsedOpportunity[]
    goalIds: Map<string, string>
    summary: PipelineImportSummary
}) {
    const existing = await listOpportunityRows({ funderId, includeClosed: true, includeArchived: false })
    let changed = 0
    for (const parsed of opportunities) {
        const goalId = goalIds.get(parsed.goalType)!
        const match = existing.find(opportunity => opportunity.goal_id === goalId)
        if (!match) {
            await createOpportunityRow({
                funderId,
                goalId,
                name: defaultOpportunityName({ goalType: parsed.goalType }),
                stage: parsed.stage,
                amountCents: centsToBigInt({ cents: parsed.amountCents }),
                probabilityOverride: null,
                expectedDecisionAt: null,
                expectedReceiptAt: null,
                receivedAt: null,
                nextStep: parsed.nextStep,
                ownerId: null,
            })
            summary.opportunitiesCreated++
            changed++
            continue
        }
        const changes: Record<string, ChangeValue> = { stage: parsed.stage, next_step: parsed.nextStep }
        if (parsed.amountCents !== null) {
            changes.amount_cents = parsed.amountCents
        }
        const events = await applyFieldChanges({
            entityType: 'opportunity',
            entityId: match.id,
            changes: await withoutDashboardEdits({ entityType: 'opportunity', entityId: match.id, changes }),
            source: 'import',
            reason: 'Spreadsheet import',
        })
        if (events.length > 0) {
            summary.opportunitiesUpdated++
            changed++
        }
    }
    return changed
}

/**
 * Drop changes the sheet shouldn't make: fields changed in the dashboard since (by a person, or an
 * applied AI update from email), and blank cells (a blank in the sheet never clears a value).
 *
 * @param input.entityType - `funder` or `opportunity`.
 * @param input.entityId - The record.
 * @param input.changes - Proposed changes.
 * @returns The changes that may be applied.
 */
async function withoutDashboardEdits({
    entityType,
    entityId,
    changes,
}: {
    entityType: ChangeEntityType
    entityId: string
    changes: Record<string, ChangeValue>
}) {
    const allowed: Record<string, ChangeValue> = {}
    for (const [field, value] of Object.entries(changes)) {
        if (value === null) {
            continue
        }
        if (!(await latestNonImportChangeAt({ entityType, entityId, field }))) {
            allowed[field] = value
        }
    }
    return allowed
}

/**
 * Remove contacts whose email already belongs to someone in the database.
 *
 * @param input.contacts - Parsed contacts.
 * @param input.funderName - For the skip message.
 * @param input.summary - Collects skip messages.
 * @returns Contacts safe to create.
 */
async function withoutTakenEmails({
    contacts,
    funderName,
    summary,
}: {
    contacts: ParsedContact[]
    funderName: string
    summary: PipelineImportSummary
}) {
    const available: ParsedContact[] = []
    for (const contact of contacts) {
        if (contact.email && config.internalEmailDomains.includes(emailDomain({ email: contact.email }))) {
            summary.skipped.push(`${funderName}: ${contact.email} is an Earth Bank address, not a funder contact.`)
            continue
        }
        if (contact.email && (await findContactByEmail({ email: contact.email }))) {
            summary.skipped.push(`${funderName}: ${contact.email} is already a contact elsewhere.`)
            continue
        }
        available.push(contact)
    }
    return available
}
