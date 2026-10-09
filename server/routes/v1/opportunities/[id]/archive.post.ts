import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findOpportunity, updateOpportunityColumns } from '#server/database/opportunities.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Opportunities'],
        summary: 'Archive an opportunity',
        description:
            'Removes it from the pipeline and every total. Use the "lost" stage instead when a funder said no.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Archived' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const opportunityId = getRouterParam(event, 'id') ?? ''
    if (!(await findOpportunity({ opportunityId }))) {
        throw notFound({ resource: 'Opportunity' })
    }
    await updateOpportunityColumns({ opportunityId, data: { archived_at: new Date() } })
    await recordAudit({
        actor: ctx.actor,
        action: 'opportunity.archived',
        entityType: 'opportunity',
        entityId: opportunityId,
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
