import type { MilestoneRow } from '#server/database/milestones.ts'
import { toDateOnly } from '#server/utils/dates.ts'
import type { GoalType, MilestoneKind, MilestoneStatus } from '#shared/constants/pipeline.ts'
import type { Milestone } from '#shared/schemas/index.ts'

/**
 * Public shape of a milestone with task progress.
 *
 * @param input.milestone - The milestone with relations.
 * @param input.today - Today's date (YYYY-MM-DD), for "overdue".
 * @returns The API representation.
 */
export function serializeMilestone({ milestone, today }: { milestone: MilestoneRow; today: string }): Milestone {
    const dueAt = toDateOnly({ date: milestone.due_at })!
    return {
        id: milestone.id,
        title: milestone.title,
        description: milestone.description,
        due_at: dueAt,
        kind: milestone.kind as MilestoneKind,
        status: milestone.status as MilestoneStatus,
        is_overdue: milestone.status === 'open' && dueAt < today,
        goal_type: (milestone.goal?.type as GoalType | undefined) ?? null,
        opportunity: milestone.opportunity
            ? {
                  id: milestone.opportunity.id,
                  name: milestone.opportunity.name,
                  funder: { id: milestone.opportunity.funder.id, name: milestone.opportunity.funder.name },
              }
            : null,
        funder: milestone.funder ? { id: milestone.funder.id, name: milestone.funder.name } : null,
        task_counts: {
            total: milestone.tasks.length,
            done: milestone.tasks.filter(task => task.status === 'done').length,
        },
        created_at: milestone.created_at.toISOString(),
    }
}
