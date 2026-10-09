import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findTask, updateTaskRow } from '#server/database/tasks.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { notFound } from '#server/utils/errors.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Delete a task',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Deleted' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const taskId = getRouterParam(event, 'id') ?? ''
    const task = await findTask({ taskId })
    if (!task) {
        throw notFound({ resource: 'Task' })
    }
    await updateTaskRow({ taskId, data: { archived_at: new Date() } })
    await recordAudit({
        actor: ctx.actor,
        action: 'task.deleted',
        entityType: 'task',
        entityId: taskId,
        changes: { title: task.title },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
