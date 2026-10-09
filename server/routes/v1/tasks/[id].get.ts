import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { loadTaskDetail } from '#server/utils/tasks.ts'
import { requestToday } from '#server/utils/time-zone.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Get a task',
        description: 'The task with its comments and attachments.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
            200: {
                description: 'The task',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskDetail' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    return loadTaskDetail({ taskId: getRouterParam(event, 'id') ?? '', today: requestToday({ event }) })
})
