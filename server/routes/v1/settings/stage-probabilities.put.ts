import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { writeStageProbabilities } from '#server/utils/settings.ts'
import { StageProbabilities } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Settings'],
        summary: 'Set stage probabilities',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StageProbabilities' } } },
        },
        responses: {
            200: {
                description: 'Saved',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/StageProbabilities' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const stageProbabilities = await parseBody({ event, schema: StageProbabilities })
    await writeStageProbabilities({ stageProbabilities })
    await recordAudit({
        actor: ctx.actor,
        action: 'settings.stage_probabilities_updated',
        entityType: 'setting',
        entityId: 'stage_probabilities',
        changes: stageProbabilities,
        ip: requestIp({ event }),
    })
    return stageProbabilities
})
