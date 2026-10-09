import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findComment, updateCommentRow } from '#server/database/comments.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { forbidden, notFound } from '#server/utils/errors.ts'
import { serializeComment } from '#server/utils/serializers/tasks.ts'
import { UpdateCommentRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Edit a comment',
        description: 'Only the author can edit their comment.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateCommentRequest' } } },
        },
        responses: {
            200: {
                description: 'The edited comment',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Comment' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const commentId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: UpdateCommentRequest })
    const existing = await findComment({ commentId })
    if (!existing) {
        throw notFound({ resource: 'Comment' })
    }
    if (existing.author_id !== ctx.user.id) {
        throw forbidden({ message: 'Only the author can edit a comment.', code: 'not_comment_author' })
    }
    const comment = await updateCommentRow({ commentId, body: body.body, editedAt: new Date() })
    await recordAudit({
        actor: ctx.actor,
        action: 'comment.edited',
        entityType: 'comment',
        entityId: commentId,
        ip: requestIp({ event }),
    })
    return serializeComment({ comment })
})
