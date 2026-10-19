import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { badRequest } from '#server/utils/errors.ts'
import { approveFund } from '#server/utils/funds/approve.ts'
import { loadFundDetail, requireFund } from '#server/utils/funds/fund-detail.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Approve a fund',
        description:
            'Moves a fund the spider found from pending to the approved list (and onto the board and map) and queues its research if it has none yet. Approving an approved fund does nothing.',
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
        throw badRequest({ message: 'Restore the fund before approving it.', code: 'fund_archived' })
    }
    const isApproved = await approveFund({ fundManagerId, approvedById: ctx.user.id, now: new Date() })
    if (isApproved) {
        await recordAudit({
            actor: ctx.actor,
            action: 'fund.approved',
            entityType: 'fund',
            entityId: fundManagerId,
            ip: requestIp({ event }),
        })
    }
    return loadFundDetail({ fundManagerId })
})
