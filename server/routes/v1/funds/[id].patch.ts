import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findFundManagerByIdentity, updateFundManagerColumns } from '#server/database/fund-managers.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { conflict } from '#server/utils/errors.ts'
import { loadFundDetail, requireFund } from '#server/utils/funds/fund-detail.ts'
import { assertActiveUser } from '#server/utils/users.ts'
import { UpdateFundRequest } from '#shared/schemas/index.ts'
import { organizationNameKey, websiteDomain } from '#shared/funds/organization-names.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Update a fund',
        description:
            "Edits the team's own fields: name, website, stage, fit tags, notes and owner. Research findings aren't edited here.",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateFundRequest' } } },
        },
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
    const body = await parseBody({ event, schema: UpdateFundRequest })
    await assertActiveUser({ userId: body.owner_id })

    const nameKey = body.name ? organizationNameKey({ name: body.name }) : undefined
    const domain = body.website_url === undefined ? undefined : websiteDomain({ url: body.website_url })
    if ((nameKey && nameKey !== fund.name_key) || (domain && domain !== fund.website_domain)) {
        const clash = await findFundManagerByIdentity({
            nameKey: nameKey ?? fund.name_key,
            websiteDomain: domain ?? null,
        })
        if (clash && clash.id !== fundManagerId) {
            throw conflict({ message: `${clash.name} already uses that name or website.` })
        }
    }
    await updateFundManagerColumns({
        fundManagerId,
        data: {
            name: body.name,
            name_key: nameKey,
            website_url: body.website_url,
            website_domain: domain,
            stage: body.stage,
            fit_tags: body.fit_tags,
            notes: body.notes,
            owner_id: body.owner_id,
        },
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'fund.updated',
        entityType: 'fund',
        entityId: fundManagerId,
        changes: { fields: Object.keys(body) },
        ip: requestIp({ event }),
    })
    return loadFundDetail({ fundManagerId })
})
