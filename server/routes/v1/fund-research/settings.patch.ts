import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { readFundResearchSettings, writeFundResearchSettings } from '#server/utils/funds/research-settings.ts'
import { resumeFundResearch } from '#server/utils/funds/resume.ts'
import { UpdateFundResearchSettingsRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Update research settings',
        description: 'Changing the budget or turning the spider back on also queues research that was paused.',
        requestBody: {
            required: true,
            content: {
                'application/json': { schema: { $ref: '#/components/schemas/UpdateFundResearchSettingsRequest' } },
            },
        },
        responses: {
            200: {
                description: 'Settings',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/FundResearchSettings' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: UpdateFundResearchSettingsRequest })
    const settings = await writeFundResearchSettings({ settings: { ...(await readFundResearchSettings()), ...body } })
    await recordAudit({
        actor: ctx.actor,
        action: 'fund_research.settings_updated',
        entityType: 'setting',
        entityId: 'fund_research',
        changes: body,
        ip: requestIp({ event }),
    })
    await resumeFundResearch({ now: new Date() })
    return settings
})
