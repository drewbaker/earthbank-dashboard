import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findFundFinding, setFundFindingStatus, supersedeOtherFindings } from '#server/database/fund-research.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { loadFundDetail } from '#server/utils/funds/fund-detail.ts'
import { refreshFundResearchValues } from '#server/utils/funds/refresh-values.ts'
import type { FundResearchField } from '#shared/constants/funds.ts'
import { FUND_RESEARCH_FIELD_DETAILS } from '#shared/constants/funds.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Restore a rejected finding',
        description: 'Brings a rejected finding back (for a single-value field it becomes the current value).',
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
    await setFundFindingStatus({ findingId: finding.id, status: 'active', userId: null, now: new Date() })
    if (!FUND_RESEARCH_FIELD_DETAILS[finding.field as FundResearchField]?.isList) {
        await supersedeOtherFindings({
            fundManagerId: finding.fund_manager_id,
            field: finding.field,
            keepFindingId: finding.id,
        })
    }
    await refreshFundResearchValues({ fundManagerId: finding.fund_manager_id })
    await recordAudit({
        actor: ctx.actor,
        action: 'fund_finding.restored',
        entityType: 'fund',
        entityId: finding.fund_manager_id,
        changes: { finding_id: finding.id, field: finding.field },
        ip: requestIp({ event }),
    })
    return loadFundDetail({ fundManagerId: finding.fund_manager_id })
})
