import type { Contact as ContactRow } from '#server/generated/prisma/client.ts'
import type { Contact } from '#shared/schemas/index.ts'

/**
 * Public shape of a contact.
 *
 * @param input.contact - The contact row.
 * @returns The API representation.
 */
export function serializeContact({ contact }: { contact: ContactRow }): Contact {
    return {
        id: contact.id,
        funder_id: contact.funder_id,
        name: contact.name,
        title: contact.title,
        email: contact.email,
        notes: contact.notes,
        created_at: contact.created_at.toISOString(),
    }
}
