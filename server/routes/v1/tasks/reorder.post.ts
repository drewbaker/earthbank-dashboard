import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { reorderTaskRows } from '#server/database/tasks.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { ReorderTasksRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Reorder tasks',
        description: 'Saves the order of tasks, e.g. within a milestone. The first id comes first.',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ReorderTasksRequest' } } },
        },
        responses: { 204: { description: 'Saved' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: ReorderTasksRequest })
    await reorderTaskRows({ taskIds: body.task_ids })
    await recordAudit({
        actor: ctx.actor,
        action: 'task.reordered',
        entityType: 'task',
        entityId: body.task_ids[0]!,
        changes: { task_ids: body.task_ids },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
