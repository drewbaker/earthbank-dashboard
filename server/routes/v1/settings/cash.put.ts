import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { updateCashSettings } from '#server/utils/cash-settings.ts'
import { UpdateCashSettingsRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Settings'],
        summary: 'Update cash settings',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateCashSettingsRequest' } } },
        },
        responses: {
            200: {
                description: 'Saved settings',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/CashSettings' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const changes = await parseBody({ event, schema: UpdateCashSettingsRequest })
    const settings = await updateCashSettings({ changes })
    await recordAudit({
        actor: ctx.actor,
        action: 'settings.cash_updated',
        entityType: 'setting',
        entityId: 'cash_settings',
        changes,
        ip: requestIp({ event }),
    })
    return settings
})
