import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findContact, findContactByEmail, updateContactRow } from '#server/database/contacts.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { conflict, notFound } from '#server/utils/errors.ts'
import { serializeContact } from '#server/utils/serializers/contacts.ts'
import { UpdateContactRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Contacts'],
        summary: 'Update a contact',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateContactRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated contact',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const contactId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdateContactRequest })
    const existing = await findContact({ contactId })
    if (!existing || existing.archived_at) {
        throw notFound({ resource: 'Contact' })
    }
    if (body.email && body.email !== existing.email) {
        const sameEmail = await findContactByEmail({ email: body.email })
        if (sameEmail && sameEmail.id !== contactId) {
            throw conflict({ message: `${body.email} is already a contact.` })
        }
    }
    const contact = await updateContactRow({
        contactId,
        name: body.name,
        title: body.title,
        email: body.email,
        notes: body.notes,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'contact.updated',
        entityType: 'contact',
        entityId: contactId,
        changes: { fields: Object.keys(body) },
        ip: requestIp({ event }),
    })
    return serializeContact({ contact })
})
