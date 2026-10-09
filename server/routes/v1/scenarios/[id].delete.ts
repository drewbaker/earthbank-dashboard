import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findScenario, updateScenarioRow } from '#server/database/scenarios.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Forecast'],
        summary: 'Delete a scenario',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Deleted' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const scenarioId = getRouterParam(event, 'id') ?? ''
    const scenario = await findScenario({ scenarioId })
    if (!scenario) {
        throw notFound({ resource: 'Scenario' })
    }
    await updateScenarioRow({ scenarioId, data: { archived_at: new Date() } })
    await recordAudit({
        actor: ctx.actor,
        action: 'scenario.deleted',
        entityType: 'scenario',
        entityId: scenarioId,
        changes: { name: scenario.name },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
