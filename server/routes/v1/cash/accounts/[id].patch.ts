import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { setBankAccountIncluded } from '#server/database/bank.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { loadCashSummary } from '#server/utils/cash.ts'
import { todayDateOnly } from '#server/utils/dates.ts'
import { UpdateBankAccountRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Cash'],
        summary: 'Include or exclude a bank account',
        description: 'Excluded accounts (e.g. a credit card or a restricted fund) do not count toward cash or burn.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateBankAccountRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated cash summary',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/CashSummary' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const bankAccountId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdateBankAccountRequest })
    await setBankAccountIncluded({ bankAccountId, isIncluded: body.is_included })
    await recordAudit({
        actor: ctx.actor,
        action: 'bank_account.updated',
        entityType: 'bank_account',
        entityId: bankAccountId,
        changes: body,
        ip: requestIp({ event }),
    })
    return loadCashSummary({ today: todayDateOnly() })
})
