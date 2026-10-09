// Covers who gets emailed about tasks: assignees (not when they assign themselves), and on comments
// the assignee plus earlier commenters, never the author or deactivated users.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

const sentEmails = vi.hoisted(() => [] as { to: string; subject: string; text: string }[])

vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueEmail: async (email: { to: string; subject: string; text: string }) => {
        sentEmails.push(email)
    },
}))

const { cleanupTestDatabase } = setupTestDatabase()
const users: Record<'drew' | 'leslie' | 'steve', string> = { drew: '', leslie: '', steve: '' }

beforeAll(async () => {
    users.drew = (await createTestUser({ email: 'drew@theearthbank.org', name: 'Drew' })).id
    users.leslie = (await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })).id
    users.steve = (await createTestUser({ email: 'steve@theearthbank.org', name: 'Steve' })).id
})

beforeEach(() => {
    sentEmails.length = 0
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * Create a task assigned to someone.
 *
 * @param input.assigneeId - Assignee.
 * @param input.title - Title.
 * @returns The task row with relations.
 */
async function createTask({ assigneeId, title }: { assigneeId: string; title: string }) {
    const { createTaskRow } = await import('#server/database/tasks.ts')
    return createTaskRow({
        title,
        description: null,
        status: 'todo',
        assigneeId,
        dueAt: new Date('2026-12-01T00:00:00Z'),
        milestoneId: null,
        opportunityId: null,
        funderId: null,
        createdById: users.drew,
    })
}

describe('notifyTaskAssigned', () => {
    it('emails the assignee with the task and deadline', async () => {
        const { notifyTaskAssigned } = await import('#server/utils/notifications.ts')
        const task = await createTask({ assigneeId: users.leslie, title: 'Send UBS the concept note' })
        await notifyTaskAssigned({ task, assigneeId: users.leslie, actorUserId: users.drew })
        expect(sentEmails).toHaveLength(1)
        expect(sentEmails[0]).toMatchObject({
            to: 'leslie@theearthbank.org',
            subject: 'Task: Send UBS the concept note',
        })
        expect(sentEmails[0]!.text).toContain('Drew assigned you a task')
        expect(sentEmails[0]!.text).toContain('Due Dec 1, 2026')
    })

    it('stays quiet when you assign yourself', async () => {
        const { notifyTaskAssigned } = await import('#server/utils/notifications.ts')
        const task = await createTask({ assigneeId: users.drew, title: 'My own task' })
        await notifyTaskAssigned({ task, assigneeId: users.drew, actorUserId: users.drew })
        expect(sentEmails).toHaveLength(0)
    })
})

describe('notifyTaskCommented', () => {
    it('emails the assignee and earlier commenters, not the author', async () => {
        const { notifyTaskCommented } = await import('#server/utils/notifications.ts')
        const { createCommentRow } = await import('#server/database/comments.ts')
        const task = await createTask({ assigneeId: users.leslie, title: 'Prep IC deck for Shell' })
        await createCommentRow({ taskId: task.id, authorId: users.steve, body: 'I can review Friday.' })

        const notified = await notifyTaskCommented({ task, authorId: users.drew, body: 'Draft is in the folder.' })
        expect(notified.sort()).toEqual([users.leslie, users.steve].sort())
        expect(sentEmails.map(email => email.to).sort()).toEqual(['leslie@theearthbank.org', 'steve@theearthbank.org'])
        expect(sentEmails[0]!.text).toContain('Draft is in the folder.')
    })

    it('skips deactivated people', async () => {
        const { notifyTaskCommented } = await import('#server/utils/notifications.ts')
        const { deactivateUser } = await import('#server/database/users.ts')
        const task = await createTask({ assigneeId: users.steve, title: 'Call Rockefeller' })
        await deactivateUser({ userId: users.steve, deactivatedAt: new Date() })

        await notifyTaskCommented({ task, authorId: users.drew, body: 'Any update?' })
        expect(sentEmails).toHaveLength(0)
    })
})

describe('sendTaskDigests', () => {
    it('sends one digest per person with overdue and upcoming tasks', async () => {
        const { sendTaskDigests } = await import('#server/utils/notifications.ts')
        const digests = await sendTaskDigests({ now: new Date('2026-11-28T13:00:00Z') })
        // Leslie has two tasks due Dec 1; Drew has one; Steve is deactivated.
        expect(digests).toBe(2)
        const leslieDigest = sentEmails.find(email => email.to === 'leslie@theearthbank.org')!
        expect(leslieDigest.text).toContain('You have 2 tasks due this week')
    })
})
