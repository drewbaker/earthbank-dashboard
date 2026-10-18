import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { config } from '#server/utils/config.ts'
import { badRequest, notFound } from '#server/utils/errors.ts'
import { findPublicInvestmentSource } from '#server/utils/funds/public-investment-sources.ts'
import { enqueuePublicInvestmentSync } from '#server/utils/jobs/enqueue.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Sync a public investment list now',
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 202: { description: 'Sync queued' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const source = findPublicInvestmentSource({ key: getRouterParam(event, 'key') ?? '' })
    if (!source) {
        throw notFound({ resource: 'List' })
    }
    if (!config.anthropicApiKey) {
        throw badRequest({ message: 'Set ANTHROPIC_API_KEY to read public lists.', code: 'ai_not_configured' })
    }
    const result = await enqueuePublicInvestmentSync({ sourceKey: source.key })
    await recordAudit({
        actor: ctx.actor,
        action: 'public_investment_source.sync_requested',
        entityType: 'public_investment_source',
        entityId: source.key,
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 202)
    return { result }
})
