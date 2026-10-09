import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { createTaskRow } from '#server/database/tasks.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { fromDateOnly } from '#server/utils/dates.ts'
import { notifyTaskAssigned } from '#server/utils/notifications.ts'
import { loadTaskDetail, resolveTaskLinks } from '#server/utils/tasks.ts'
import { assertActiveUser } from '#server/utils/users.ts'
import { CreateTaskRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Create a task',
        description: 'Emails the assignee unless they assigned it to themselves.',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTaskRequest' } } },
        },
        responses: {
            201: {
                description: 'Task created',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: CreateTaskRequest })
    await assertActiveUser({ userId: body.assignee_id })
    const links = await resolveTaskLinks({
        milestoneId: body.milestone_id ?? null,
        opportunityId: body.opportunity_id ?? null,
        funderId: body.funder_id ?? null,
    })
    const task = await createTaskRow({
        title: body.title,
        description: body.description ?? null,
        status: body.status,
        assigneeId: body.assignee_id ?? null,
        dueAt: fromDateOnly({ value: body.due_at }),
        ...links,
        createdById: ctx.user.id,
    })
    await recordAudit({
        actor: ctx.actor,
        action: 'task.created',
        entityType: 'task',
        entityId: task.id,
        changes: { title: body.title, assignee_id: body.assignee_id ?? null },
        ip: requestIp({ event }),
    })
    if (task.assignee_id) {
        await notifyTaskAssigned({ task, assigneeId: task.assignee_id, actorUserId: ctx.user.id })
    }
    setResponseStatus(event, 201)
    return loadTaskDetail({ taskId: task.id })
})
