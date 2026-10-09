import { defineRouteMeta } from 'nitropack/runtime'
import { listMilestoneRows } from '#server/database/milestones.ts'
import { defineApiHandler, parseQuery } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { fromDateOnly, todayDateOnly } from '#server/utils/dates.ts'
import { serializeMilestone } from '#server/utils/serializers/milestones.ts'
import { ListMilestonesQuery } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Milestones'],
        summary: 'List milestones',
        description: 'Open milestones by due date, with task progress. Pass include_done for completed ones.',
        parameters: [
            { name: 'include_done', in: 'query', schema: { type: 'boolean' } },
            { name: 'funder_id', in: 'query', schema: { type: 'string' } },
            {
                name: 'goal_type',
                in: 'query',
                schema: { type: 'string', enum: ['design_grant', 'opex', 'lending_capital'] },
            },
            { name: 'due_before', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
            200: {
                description: 'Milestones',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MilestoneList' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const query = parseQuery({ event, schema: ListMilestonesQuery })
    const milestones = await listMilestoneRows({
        includeDone: query.include_done,
        funderId: query.funder_id,
        goalType: query.goal_type,
        dueBefore: fromDateOnly({ value: query.due_before }) ?? undefined,
    })
    const today = todayDateOnly()
    return {
        data: milestones.map(milestone => serializeMilestone({ milestone, today })),
        next_cursor: null,
        has_more: false,
    }
})
