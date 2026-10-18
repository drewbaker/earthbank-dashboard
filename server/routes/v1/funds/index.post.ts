import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { conflict } from '#server/utils/errors.ts'
import { addFund } from '#server/utils/funds/add-fund.ts'
import { loadFundDetail } from '#server/utils/funds/fund-detail.ts'
import { CreateFundRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Add a fund',
        description:
            'Adds a lender to the list and queues its research (ahead of funds the spider found). Name and website are required; the LinkedIn company page is optional.',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateFundRequest' } } },
        },
        responses: {
            201: {
                description: 'Fund added',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundDetail' } } },
            },
            409: {
                description: 'A fund with that name or website is already on the list',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: CreateFundRequest })
    const { fund, isNew } = await addFund({
        name: body.name,
        websiteUrl: body.website_url,
        linkedinUrl: body.linkedin_url ?? null,
        origin: 'manual',
        now: new Date(),
    })
    if (!isNew) {
        throw conflict({ message: `${fund.name} is already on the list.` })
    }
    await recordAudit({
        actor: ctx.actor,
        action: 'fund.created',
        entityType: 'fund',
        entityId: fund.id,
        changes: { name: fund.name, website_url: fund.website_url },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return loadFundDetail({ fundManagerId: fund.id })
})
