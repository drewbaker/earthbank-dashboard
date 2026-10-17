import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { setFundResearchStatus } from '#server/database/fund-managers.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { badRequest } from '#server/utils/errors.ts'
import { loadFundDetail, requireFund } from '#server/utils/funds/fund-detail.ts'
import { enqueueFundResearch } from '#server/utils/jobs/enqueue.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Research a fund again',
        description:
            'Queues a new research run, ahead of funds the spider found. It fills gaps and adds newer information.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
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
    const fund = await requireFund({ fundManagerId })
    if (fund.archived_at) {
        throw badRequest({ message: 'Restore the fund before researching it.', code: 'fund_archived' })
    }
    // Asking by hand puts it ahead of the spider, whatever its origin.
    await enqueueFundResearch({ fundManagerId, isPriority: true })
    await setFundResearchStatus({ fundManagerId, status: 'queued', now: new Date() })
    await recordAudit({
        actor: ctx.actor,
        action: 'fund.research_requested',
        entityType: 'fund',
        entityId: fundManagerId,
        ip: requestIp({ event }),
    })
    return loadFundDetail({ fundManagerId })
})
