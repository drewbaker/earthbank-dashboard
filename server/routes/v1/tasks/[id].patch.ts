import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findTask, updateTaskRow } from '#server/database/tasks.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { fromDateOnly } from '#server/utils/dates.ts'
import { notFound } from '#server/utils/errors.ts'
import { notifyTaskAssigned } from '#server/utils/notifications.ts'
import { loadTaskDetail, resolveTaskLinks } from '#server/utils/tasks.ts'
import { assertActiveUser } from '#server/utils/users.ts'
import { requestToday } from '#server/utils/time-zone.ts'
import { UpdateTaskRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Update a task',
        description: 'Emails the new assignee when the assignee changes (unless they assigned themselves).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateTaskRequest' } } },
        },
        responses: {
            200: {
                description: 'The updated task',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const taskId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdateTaskRequest })
    const existing = await findTask({ taskId })
    if (!existing) {
        throw notFound({ resource: 'Task' })
    }
    await assertActiveUser({ userId: body.assignee_id })
    const isRelinking =
        body.milestone_id !== undefined || body.opportunity_id !== undefined || body.funder_id !== undefined
    const links = isRelinking
        ? await resolveTaskLinks({
              milestoneId: body.milestone_id === undefined ? existing.milestone_id : body.milestone_id,
              opportunityId: body.opportunity_id === undefined ? existing.opportunity_id : body.opportunity_id,
              funderId: body.funder_id === undefined ? existing.funder_id : body.funder_id,
          })
        : null
    const task = await updateTaskRow({
        taskId,
        data: {
            title: body.title,
            description: body.description,
            status: body.status,
            assignee_id: body.assignee_id,
            due_at: body.due_at === undefined ? undefined : fromDateOnly({ value: body.due_at }),
            completed_at: completedAtFor({ status: body.status, previousStatus: existing.status }),
            ...(links
                ? { milestone_id: links.milestoneId, opportunity_id: links.opportunityId, funder_id: links.funderId }
                : {}),
        },
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'task.updated',
        entityType: 'task',
        entityId: taskId,
        changes: body,
        ip: requestIp({ event }),
    })
    if (body.assignee_id && body.assignee_id !== existing.assignee_id) {
        await notifyTaskAssigned({ task, assigneeId: body.assignee_id, actorUserId: ctx.user.id })
    }
    return loadTaskDetail({ taskId, today: requestToday({ event }) })
})

/**
 * Keep `completed_at` in step with the status: stamped when a task is finished, cleared when reopened.
 *
 * @param input.status - New status, if changing.
 * @param input.previousStatus - Current status.
 * @returns The value to write, or undefined to leave it.
 */
function completedAtFor({ status, previousStatus }: { status: string | undefined; previousStatus: string }) {
    if (!status || status === previousStatus) {
        return undefined
    }
    return status === 'done' ? new Date() : null
}
