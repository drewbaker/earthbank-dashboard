import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { deleteDiligenceAnswer } from '#server/database/fund-research.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { loadFundDetail, requireFund } from '#server/utils/funds/fund-detail.ts'
import { refreshFundResearchValues } from '#server/utils/funds/refresh-values.ts'
import { FUND_DILIGENCE_QUESTIONS } from '#shared/constants/funds.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Clear a due diligence answer',
        description: 'Removes the answer, so the question shows as a data gap again.',
        parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            {
                name: 'question',
                in: 'path',
                required: true,
                schema: { type: 'string', enum: [...FUND_DILIGENCE_QUESTIONS] },
            },
        ],
        responses: {
            200: {
                description: 'The fund',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const fundManagerId = getRouterParam(event, 'id') ?? ''
    const question = getRouterParam(event, 'question') ?? ''
    await requireFund({ fundManagerId })
    if (!(FUND_DILIGENCE_QUESTIONS as readonly string[]).includes(question)) {
        throw notFound({ resource: 'Question' })
    }
    await deleteDiligenceAnswer({ fundManagerId, question })
    await refreshFundResearchValues({ fundManagerId })
    await recordAudit({
        actor: ctx.actor,
        action: 'fund.diligence_cleared',
        entityType: 'fund',
        entityId: fundManagerId,
        changes: { question },
        ip: requestIp({ event }),
    })
    return loadFundDetail({ fundManagerId })
})
