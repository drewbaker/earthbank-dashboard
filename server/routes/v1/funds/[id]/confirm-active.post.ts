import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { confirmFundActivity } from '#server/database/fund-managers.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { loadFundDetail, requireFund } from '#server/utils/funds/fund-detail.ts'
import { refreshFundResearchValues } from '#server/utils/funds/refresh-values.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Confirm a fund is still active',
        description:
            'Records that a team member knows the fund is still operating. It counts as activity today, so the fund is no longer shown as "Possibly closed" (until another 12 months pass with no activity).',
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
    await requireFund({ fundManagerId })
    await confirmFundActivity({ fundManagerId, userId: ctx.user.id, now: new Date() })
    await refreshFundResearchValues({ fundManagerId })
    await recordAudit({
        actor: ctx.actor,
        action: 'fund.activity_confirmed',
        entityType: 'fund',
        entityId: fundManagerId,
        ip: requestIp({ event }),
    })
    return loadFundDetail({ fundManagerId })
})
