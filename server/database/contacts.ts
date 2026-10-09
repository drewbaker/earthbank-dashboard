import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Create a contact at a funder.
 *
 * @param input.funderId - The funder.
 * @param input.name - Person's name.
 * @param input.title - Job title, if known.
 * @param input.email - Normalized email, if known.
 * @param input.notes - Free-text notes.
 * @returns The contact row.
 */
export function createContactRow({
    funderId,
    name,
    title,
    email,
    notes,
}: {
    funderId: string
    name: string
    title: string | null
    email: string | null
    notes: string | null
}) {
    return db().contact.create({
        data: { id: newId({ kind: 'contact' }), funder_id: funderId, name, title, email, notes },
    })
}

/**
 * Find a contact by id.
 *
 * @param input.contactId - The contact.
 * @returns The contact row, or null.
 */
export function findContact({ contactId }: { contactId: string }) {
    return db().contact.findUnique({ where: { id: contactId } })
}

/**
 * Find a contact by email (including archived contacts, since the address is unique).
 *
 * @param input.email - Normalized email.
 * @returns The contact row, or null.
 */
export function findContactByEmail({ email }: { email: string }) {
    return db().contact.findUnique({ where: { email } })
}

/**
 * List a funder's live contacts.
 *
 * @param input.funderId - The funder.
 * @returns Contacts ordered by name.
 */
export function listFunderContacts({ funderId }: { funderId: string }) {
    return db().contact.findMany({ where: { funder_id: funderId, archived_at: null }, orderBy: { name: 'asc' } })
}

/**
 * Update a contact.
 *
 * @param input.contactId - The contact.
 * @param input.name - New name, undefined to keep.
 * @param input.title - New title, null to clear, undefined to keep.
 * @param input.email - New email, null to clear, undefined to keep.
 * @param input.notes - New notes, null to clear, undefined to keep.
 * @param input.archivedAt - Archive time, null to restore, undefined to keep.
 * @returns The updated contact row.
 */
export function updateContactRow({
    contactId,
    name,
    title,
    email,
    notes,
    archivedAt,
}: {
    contactId: string
    name?: string
    title?: string | null
    email?: string | null
    notes?: string | null
    archivedAt?: Date | null
}) {
    return db().contact.update({
        where: { id: contactId },
        data: { name, title, email, notes, archived_at: archivedAt },
    })
}
