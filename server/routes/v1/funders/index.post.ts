import type { H3Event } from 'h3'
import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import type { AuthActor } from '#server/utils/auth.ts'
import { requireUser } from '#server/utils/auth.ts'
import { createFunderWithDetails, loadFunderDetail } from '#server/utils/funders.ts'
import { assertActiveUser } from '#server/utils/users.ts'
import { CreateFunderRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funders'],
        summary: 'Create a funder',
        description: 'Creates a funder with optional first contacts and a first opportunity.',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateFunderRequest' } } },
        },
        responses: {
            201: {
                description: 'Funder created',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FunderDetail' } } },
            },
            409: {
                description: 'A funder with that name, or a contact with that email, already exists',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: CreateFunderRequest })
    await assertActiveUser({ userId: body.owner_id })
    const funderId = await createFunderWithDetails({
        name: body.name,
        kind: body.kind,
        tier: body.tier ?? null,
        relationshipStatus: body.relationship_status,
        geoFocus: body.geo_focus ?? null,
        potentialSize: body.potential_size ?? null,
        emailDomains: body.email_domains,
        notes: body.notes ?? null,
        ownerId: body.owner_id ?? null,
        contacts: body.contacts,
        opportunity: body.opportunity
            ? {
                  goalType: body.opportunity.goal_type,
                  name: body.opportunity.name,
                  stage: body.opportunity.stage,
                  amountCents: body.opportunity.amount_cents,
                  expectedReceiptAt: body.opportunity.expected_receipt_at,
              }
            : null,
    })
    await auditFunderCreated({ event, actor: ctx.actor, funderId, name: body.name })
    setResponseStatus(event, 201)
    return loadFunderDetail({ funderId })
})

/**
 * Record the creation of a funder in the audit log.
 *
 * @param input.event - The request, for the caller's IP.
 * @param input.actor - The user who created it.
 * @param input.funderId - Id of the created funder.
 * @param input.name - Name it was created with.
 * @returns Resolves once the entry is written.
 */
async function auditFunderCreated({
    event,
    actor,
    funderId,
    name,
}: {
    event: H3Event
    actor: AuthActor
    funderId: string
    name: string
}) {
    await recordAudit({
        actor,
        action: 'funder.created',
        entityType: 'funder',
        entityId: funderId,
        changes: { name },
        ip: requestIp({ event }),
    })
}
