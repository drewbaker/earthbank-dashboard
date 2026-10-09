import { getRouterParam, setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { markCommentAttachmentsDeleted } from '#server/database/attachments.ts'
import { findComment, updateCommentRow } from '#server/database/comments.ts'
import { defineApiHandler, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { forbidden, notFound } from '#server/utils/errors.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Tasks'],
        summary: 'Delete a comment',
        description: 'Only the author can delete their comment.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Deleted' } },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const commentId = getRouterParam(event, 'id') ?? ''
    const comment = await findComment({ commentId })
    if (!comment) {
        throw notFound({ resource: 'Comment' })
    }
    if (comment.author_id !== ctx.user.id) {
        throw forbidden({ message: 'Only the author can delete a comment.', code: 'not_comment_author' })
    }
    const deletedAt = new Date()
    await updateCommentRow({ commentId, deletedAt })
    // Its files go with it.
    await markCommentAttachmentsDeleted({ commentId, deletedAt })
    await recordAudit({
        actor: ctx.actor,
        action: 'comment.deleted',
        entityType: 'comment',
        entityId: commentId,
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 204)
    return null
})
