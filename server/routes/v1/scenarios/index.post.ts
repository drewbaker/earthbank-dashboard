import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { createScenarioRow } from '#server/database/scenarios.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { serializeScenario } from '#server/utils/serializers/scenarios.ts'
import { CreateScenarioRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Forecast'],
        summary: 'Save a scenario',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateScenarioRequest' } } },
        },
        responses: {
            201: {
                description: 'Scenario saved',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Scenario' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: CreateScenarioRequest })
    const scenario = await createScenarioRow({
        name: body.name,
        description: body.description ?? null,
        adjustments: body.adjustments,
        createdById: ctx.user.id,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'scenario.created',
        entityType: 'scenario',
        entityId: scenario.id,
        changes: { name: body.name },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    return serializeScenario({ scenario })
})
