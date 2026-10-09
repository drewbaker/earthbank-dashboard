import { createContactRow, findContactByEmail, updateContactRow } from '#server/database/contacts.ts'
import { findFunder } from '#server/database/funders.ts'
import { applyFieldChanges } from '#server/utils/change-events.ts'
import { conflict, notFound } from '#server/utils/errors.ts'
import type { ChangeSource } from '#shared/constants/pipeline.ts'
import { emailDomain, isFreeMailDomain, normalizeEmailAddress } from '#shared/utils/email-addresses.ts'

/**
 * Add a contact to a funder, restoring an archived contact with the same email, and add the
 * contact's organization domain to the funder so their colleagues' mail matches too.
 *
 * @param input.funderId - The funder.
 * @param input.name - Person's name.
 * @param input.title - Job title.
 * @param input.email - Email address, if known.
 * @param input.notes - Notes.
 * @param input.source - Change source for the domain update (`manual`, `ai_email`, …).
 * @param input.actorUserId - Who added it, if a person.
 * @returns The contact row.
 * @throws ApiError 404 when the funder is missing; 409 when the email belongs to another funder's contact.
 */
export async function addContactToFunder({
    funderId,
    name,
    title = null,
    email = null,
    notes = null,
    source,
    actorUserId = null,
}: {
    funderId: string
    name: string
    title?: string | null
    email?: string | null
    notes?: string | null
    source: ChangeSource
    actorUserId?: string | null
}) {
    const funder = await findFunder({ funderId })
    if (!funder) {
        throw notFound({ resource: 'Funder' })
    }
    const normalizedEmail = email ? normalizeEmailAddress({ email }) : null
    let contact
    const existing = normalizedEmail ? await findContactByEmail({ email: normalizedEmail }) : null
    if (existing) {
        if (existing.funder_id !== funderId || !existing.archived_at) {
            throw conflict({ message: `${normalizedEmail} is already a contact.` })
        }
        contact = await updateContactRow({ contactId: existing.id, name, title, notes, archivedAt: null })
    } else {
        contact = await createContactRow({ funderId, name: name.trim(), title, email: normalizedEmail, notes })
    }

    if (normalizedEmail) {
        const domain = emailDomain({ email: normalizedEmail })
        const domains = Array.isArray(funder.email_domains) ? (funder.email_domains as string[]) : []
        if (!isFreeMailDomain({ domain }) && !domains.includes(domain)) {
            await applyFieldChanges({
                entityType: 'funder',
                entityId: funderId,
                changes: { email_domains: [...domains, domain] },
                source,
                actorUserId,
                reason: `Added with contact ${normalizedEmail}`,
            })
        }
    }
    return contact
}
