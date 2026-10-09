// Covers files on comments: a comment can be just files, files attach only to your own comment on
// the same task, the task view shows them under their comment, and deleting the comment removes them.
import { createApp, createRouter, eventHandler, toWebHandler } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

vi.mock('nitropack/runtime', () => ({ defineRouteMeta: () => undefined }))
vi.mock('#server/utils/jobs/enqueue.ts', () => ({ enqueueEmail: async () => undefined }))

const { cleanupTestDatabase } = setupTestDatabase()
const signedIn = { userId: '' }
let callApi: (request: Request) => Promise<Response>
let drewId: string
let leslieId: string
let taskId: string

beforeAll(async () => {
    drewId = (await createTestUser({ email: 'drew@theearthbank.org', name: 'Drew' })).id
    leslieId = (await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })).id
    const { createTaskRow } = await import('#server/database/tasks.ts')
    taskId = (
        await createTaskRow({
            title: 'Send the deck',
            description: null,
            status: 'todo',
            assigneeId: leslieId,
            dueAt: null,
            milestoneId: null,
            opportunityId: null,
            funderId: null,
            createdById: drewId,
        })
    ).id
    const { default: createComment } = await import('#server/routes/v1/tasks/[id]/comments/index.post.ts')
    const { default: uploadAttachment } = await import('#server/routes/v1/tasks/[id]/attachments/index.post.ts')
    const { default: deleteComment } = await import('#server/routes/v1/comments/[id].delete.ts')
    const { findUser } = await import('#server/database/users.ts')
    const app = createApp()
    app.use(
        eventHandler(async event => {
            const user = await findUser({ userId: signedIn.userId })
            event.context.auth = {
                user: { id: user!.id, email: user!.email, name: user!.name, avatar_url: null, role: 'admin' },
                actor: { type: 'user', userId: user!.id },
                sessionId: 'ses_test',
            }
        }),
    )
    app.use(
        createRouter()
            .post('/v1/tasks/:id/comments', createComment)
            .post('/v1/tasks/:id/attachments', uploadAttachment)
            .delete('/v1/comments/:id', deleteComment),
    )
    callApi = toWebHandler(app)
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * Post a comment as someone.
 *
 * @param input.userId - Who comments.
 * @param input.body - JSON body.
 * @returns The response.
 */
function postComment({ userId, body }: { userId: string; body: unknown }) {
    signedIn.userId = userId
    return callApi(
        new Request(`http://localhost/v1/tasks/${taskId}/comments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
    )
}

/**
 * Upload a small file as someone, optionally to a comment.
 *
 * @param input.userId - Who uploads.
 * @param input.commentId - The comment, if any.
 * @returns The response.
 */
function uploadFile({ userId, commentId }: { userId: string; commentId?: string }) {
    signedIn.userId = userId
    const form = new FormData()
    form.append('file', new Blob(['budget'], { type: 'text/plain' }), 'budget.txt')
    if (commentId) {
        form.append('comment_id', commentId)
    }
    return callApi(new Request(`http://localhost/v1/tasks/${taskId}/attachments`, { method: 'POST', body: form }))
}

describe('files on comments', () => {
    let commentId: string

    it('accepts a comment that is only files, and refuses one with neither text nor files', async () => {
        const filesOnly = await postComment({ userId: drewId, body: { attachment_names: ['budget.txt'] } })
        expect(filesOnly.status).toBe(201)
        commentId = ((await filesOnly.json()) as { id: string }).id

        const empty = await postComment({ userId: drewId, body: { body: '  ' } })
        expect(empty.status).toBe(422)
    })

    it('attaches files only to your own comment', async () => {
        expect((await uploadFile({ userId: drewId, commentId })).status).toBe(201)
        expect((await uploadFile({ userId: leslieId, commentId })).status).toBe(403)
        expect((await uploadFile({ userId: leslieId, commentId: 'cmt_missing' })).status).toBe(404)
        expect((await uploadFile({ userId: leslieId })).status).toBe(201)
    })

    it('shows comment files under the comment and task files on the task', async () => {
        const { loadTaskDetail } = await import('#server/utils/tasks.ts')
        const task = await loadTaskDetail({ taskId })
        expect(task.attachments.map(attachment => attachment.comment_id)).toEqual([null])
        expect(task.comments[0]!.attachments).toEqual([
            expect.objectContaining({ filename: 'budget.txt', comment_id: commentId }),
        ])
    })

    it("removes a comment's files when the comment is deleted", async () => {
        signedIn.userId = drewId
        const response = await callApi(new Request(`http://localhost/v1/comments/${commentId}`, { method: 'DELETE' }))
        expect(response.status).toBe(204)
        const { loadTaskDetail } = await import('#server/utils/tasks.ts')
        const task = await loadTaskDetail({ taskId })
        expect(task.comments).toEqual([])
        expect(task.attachments).toHaveLength(1)
    })
})
