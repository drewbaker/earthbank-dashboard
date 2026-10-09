import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findScenario, updateScenarioRow } from '#server/database/scenarios.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'
import { serializeScenario } from '#server/utils/serializers/scenarios.ts'
import { UpdateScenarioRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Forecast'],
        summary: 'Update a scenario',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateScenarioRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated scenario',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Scenario' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const scenarioId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdateScenarioRequest })
    if (!(await findScenario({ scenarioId }))) {
        throw notFound({ resource: 'Scenario' })
    }
    const scenario = await updateScenarioRow({
        scenarioId,
        data: { name: body.name, description: body.description, adjustments: body.adjustments },
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'scenario.updated',
        entityType: 'scenario',
        entityId: scenarioId,
        changes: { name: body.name, adjustment_count: body.adjustments?.length },
        ip: requestIp({ event }),
    })
    return serializeScenario({ scenario })
})
