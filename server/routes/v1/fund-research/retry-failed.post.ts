import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { config } from '#server/utils/config.ts'
import { badRequest } from '#server/utils/errors.ts'
import { readFundResearchStatus } from '#server/utils/funds/research-status.ts'
import { retryFailedFundResearch } from '#server/utils/funds/resume.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Retry failed research',
        description:
            'Queues research again for every approved fund whose research failed (for example after the AI account ran out of credit). Returns the research status.',
        responses: {
            200: {
                description: 'Research status',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundResearchStatus' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    if (!config.anthropicApiKey) {
        throw badRequest({ message: 'Research needs ANTHROPIC_API_KEY.', code: 'ai_not_configured' })
    }
    const now = new Date()
    const queued = await retryFailedFundResearch({ now })
    await recordAudit({
        actor: ctx.actor,
        action: 'fund_research.failed_retried',
        entityType: 'setting',
        entityId: 'fund_research',
        changes: { queued },
        ip: requestIp({ event }),
    })
    return readFundResearchStatus({ now })
})
