import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { addContactToFunder } from '#server/utils/contacts.ts'
import { serializeContact } from '#server/utils/serializers/contacts.ts'
import { CreateContactRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Contacts'],
        summary: 'Add a contact to a funder',
        description: "The contact's organization domain is added to the funder so related mail matches.",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateContactRequest' } } },
        },
        responses: {
            201: {
                description: 'Contact added',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const funderId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: CreateContactRequest })
    const contact = await addContactToFunder({
        funderId,
        name: body.name,
        title: body.title ?? null,
        email: body.email ?? null,
        notes: body.notes ?? null,
        source: 'manual',
        actorUserId: ctx.user.id,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'contact.created',
        entityType: 'contact',
        entityId: contact.id,
        changes: { funder_id: funderId, name: contact.name },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializeContact({ contact })
})
