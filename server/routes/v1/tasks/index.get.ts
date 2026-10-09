import { defineRouteMeta } from 'nitropack/runtime'
import { listTaskRows } from '#server/database/tasks.ts'
import { defineApiHandler, parseQuery } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { fromDateOnly } from '#server/utils/dates.ts'
import { serializeTask } from '#server/utils/serializers/tasks.ts'
import { requestToday } from '#server/utils/time-zone.ts'
import { ListTasksQuery } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'List tasks',
        description:
            'Open tasks by deadline. Filter by assignee, milestone or funder; pass include_done for finished ones.',
        parameters: [
            { name: 'assignee_id', in: 'query', schema: { type: 'string' } },
            { name: 'milestone_id', in: 'query', schema: { type: 'string' } },
            { name: 'funder_id', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['todo', 'doing', 'done'] } },
            { name: 'include_done', in: 'query', schema: { type: 'boolean' } },
            { name: 'due_before', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
            200: {
                description: 'Tasks',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const query = parseQuery({ event, schema: ListTasksQuery })
    const tasks = await listTaskRows({
        assigneeId: query.assignee_id,
        milestoneId: query.milestone_id,
        funderId: query.funder_id,
        status: query.status,
        includeDone: query.include_done,
        dueBefore: fromDateOnly({ value: query.due_before }) ?? undefined,
    })
    const today = requestToday({ event })
    return { data: tasks.map(task => serializeTask({ task, today })), next_cursor: null, has_more: false }
})
