import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { updateFundManagerColumns } from '#server/database/fund-managers.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { loadFundDetail, requireFund } from '#server/utils/funds/fund-detail.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Restore an archived fund',
        description: 'Puts an archived fund back on the list.',
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
    await updateFundManagerColumns({ fundManagerId, data: { archived_at: null } })
    await recordAudit({
        actor: ctx.actor,
        action: 'fund.restored',
        entityType: 'fund',
        entityId: fundManagerId,
        ip: requestIp({ event }),
    })
    return loadFundDetail({ fundManagerId })
})
