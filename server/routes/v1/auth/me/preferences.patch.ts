import { defineRouteMeta } from 'nitropack/runtime'
import { findUser, updateUserSettings } from '#server/database/users.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { unauthorized } from '#server/utils/errors.ts'
import { serializeUserPreferences } from '#server/utils/serializers/users.ts'
import { UpdatePreferencesRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Auth'],
        summary: 'Update your preferences',
        description: 'Personal settings such as light or dark mode. They follow you to any browser.',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdatePreferencesRequest' } } },
        },
        responses: {
            200: {
                description: 'Your preferences',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/UserPreferences' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: UpdatePreferencesRequest })
    const user = await findUser({ userId: ctx.user.id })
    if (!user) {
        throw unauthorized()
    }
    const preferences = { ...serializeUserPreferences({ user }), ...stripUndefined({ values: body }) }
    const updated = await updateUserSettings({ userId: user.id, settings: preferences })
    await recordAudit({
        actor: ctx.actor,
        action: 'user.preferences_updated',
        entityType: 'user',
        entityId: user.id,
        changes: preferences,
        ip: requestIp({ event }),
    })
    return serializeUserPreferences({ user: updated })
})

/**
 * Drop fields that weren't sent, so they don't overwrite saved preferences.
 *
 * @param input.values - The parsed request body.
 * @returns The same object without undefined values.
 */
function stripUndefined({ values }: { values: Record<string, unknown> }) {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}
