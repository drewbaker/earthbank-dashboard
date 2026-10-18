import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findFundFinding, setFundFindingStatus } from '#server/database/fund-research.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { loadFundDetail } from '#server/utils/funds/fund-detail.ts'
import { refreshFundResearchValues } from '#server/utils/funds/refresh-values.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Reject a research finding',
        description:
            'Marks a finding wrong: it disappears from the profile and the research assistant never records that value again.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The fund the finding belongs to',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const finding = await findFundFinding({ findingId: getRouterParam(event, 'id') ?? '' })
    if (!finding) {
        throw notFound({ resource: 'Finding' })
    }
    await setFundFindingStatus({ findingId: finding.id, status: 'rejected', userId: ctx.user.id, now: new Date() })
    await refreshFundResearchValues({ fundManagerId: finding.fund_manager_id })
    await recordAudit({
        actor: ctx.actor,
        action: 'fund_finding.rejected',
        entityType: 'fund',
        entityId: finding.fund_manager_id,
        changes: { finding_id: finding.id, field: finding.field },
        ip: requestIp({ event }),
    })
    return loadFundDetail({ fundManagerId: finding.fund_manager_id })
})
