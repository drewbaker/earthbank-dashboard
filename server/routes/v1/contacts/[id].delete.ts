import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findContact, updateContactRow } from '#server/database/contacts.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Contacts'],
        summary: 'Remove a contact',
        description: 'Archives the contact. Adding the same email to the same funder later restores it.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Removed' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const contactId = getRouterParam(event, 'id') ?? ''
    const contact = await findContact({ contactId })
    if (!contact || contact.archived_at) {
        throw notFound({ resource: 'Contact' })
    }
    await updateContactRow({ contactId, archivedAt: new Date() })
    await recordAudit({
        actor: ctx.actor,
        action: 'contact.removed',
        entityType: 'contact',
        entityId: contactId,
        changes: { funder_id: contact.funder_id, name: contact.name },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
