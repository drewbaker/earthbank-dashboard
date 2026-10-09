import { listTaskCommenterIds } from '#server/database/comments.ts'
import type { TaskRow } from '#server/database/tasks.ts'
import { listOpenTasksDueBefore } from '#server/database/tasks.ts'
import { findUser } from '#server/database/users.ts'
import { config } from '#server/utils/config.ts'
import { toDateOnly } from '#server/utils/dates.ts'
import { renderEmail } from '#server/utils/email/layout.ts'
import { enqueueEmail } from '#server/utils/jobs/enqueue.ts'

/**
 * Email someone that a task was assigned to them. Nobody is emailed about assigning themselves.
 *
 * @param input.task - The task with relations.
 * @param input.assigneeId - The new assignee.
 * @param input.actorUserId - Who assigned it.
 * @returns Resolves once the email is queued (or skipped).
 */
export async function notifyTaskAssigned({
    task,
    assigneeId,
    actorUserId,
}: {
    task: TaskRow
    assigneeId: string
    actorUserId: string
}) {
    if (assigneeId === actorUserId) {
        return
    }
    const [assignee, actor] = await Promise.all([findUser({ userId: assigneeId }), findUser({ userId: actorUserId })])
    if (!assignee || assignee.deactivated_at) {
        return
    }
    const due = toDateOnly({ date: task.due_at })
    const context = [
        task.milestone ? `Milestone: ${task.milestone.title}` : null,
        task.opportunity ? `Opportunity: ${task.opportunity.funder.name} · ${task.opportunity.name}` : null,
        due ? `Due ${formatEmailDate({ value: due })}` : null,
    ].filter((line): line is string => line !== null)
    const { html, text } = renderEmail({
        heading: `${actor?.name ?? 'Someone'} assigned you a task`,
        paragraphs: [task.title, ...context],
        quote: task.description ?? undefined,
        buttonLabel: 'Open task',
        buttonUrl: taskUrl({ taskId: task.id }),
    })
    await enqueueEmail({ to: assignee.email, subject: `Task: ${task.title}`, html, text })
}

/**
 * Email the task's assignee and earlier commenters about a new comment, never the author.
 *
 * @param input.task - The task with relations.
 * @param input.authorId - Who commented.
 * @param input.body - The comment text.
 * @returns The user ids that were emailed.
 */
export async function notifyTaskCommented({ task, authorId, body }: { task: TaskRow; authorId: string; body: string }) {
    const recipientIds = new Set(await listTaskCommenterIds({ taskId: task.id }))
    if (task.assignee_id) {
        recipientIds.add(task.assignee_id)
    }
    recipientIds.delete(authorId)
    const author = await findUser({ userId: authorId })
    const notified: string[] = []
    for (const recipientId of recipientIds) {
        const recipient = await findUser({ userId: recipientId })
        if (!recipient || recipient.deactivated_at) {
            continue
        }
        const { html, text } = renderEmail({
            heading: `${author?.name ?? 'Someone'} commented on "${task.title}"`,
            paragraphs: [],
            quote: body,
            buttonLabel: 'Reply',
            buttonUrl: taskUrl({ taskId: task.id }),
        })
        await enqueueEmail({ to: recipient.email, subject: `Re: ${task.title}`, html, text })
        notified.push(recipientId)
    }
    return notified
}

/**
 * Email each person a list of their open tasks that are overdue or due within a week.
 *
 * @param input.now - Current time.
 * @returns The number of digests queued.
 */
export async function sendTaskDigests({ now }: { now: Date }) {
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const tasks = await listOpenTasksDueBefore({ dueBefore: weekAhead })
    const byAssignee = new Map<string, TaskRow[]>()
    for (const task of tasks) {
        if (task.assignee) {
            byAssignee.set(task.assignee.id, [...(byAssignee.get(task.assignee.id) ?? []), task])
        }
    }
    const today = toDateOnly({ date: now })!
    for (const assigneeTasks of byAssignee.values()) {
        const assignee = assigneeTasks[0]!.assignee!
        const lines = assigneeTasks.map(task => {
            const due = toDateOnly({ date: task.due_at })!
            const label =
                due < today
                    ? `overdue since ${formatEmailDate({ value: due })}`
                    : `due ${formatEmailDate({ value: due })}`
            return `• ${task.title} (${label})`
        })
        const { html, text } = renderEmail({
            heading: `You have ${assigneeTasks.length} task${assigneeTasks.length === 1 ? '' : 's'} due this week`,
            paragraphs: lines,
            buttonLabel: 'See my tasks',
            buttonUrl: `${config.appUrl}/milestones?view=people`,
        })
        await enqueueEmail({ to: assignee.email, subject: 'Your Earth Bank tasks this week', html, text })
    }
    return byAssignee.size
}

/**
 * Link to a task in the dashboard.
 *
 * @param input.taskId - The task.
 * @returns Absolute URL.
 */
function taskUrl({ taskId }: { taskId: string }) {
    return `${config.appUrl}/milestones?task=${taskId}`
}

/**
 * Format a calendar date for email text ("Jan 1, 2026").
 *
 * @param input.value - YYYY-MM-DD.
 * @returns The formatted date.
 */
function formatEmailDate({ value }: { value: string }) {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    })
}
