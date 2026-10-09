import { getRouterParam } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findMailboxConnectionForUser } from '#server/database/mailboxes.ts'
import { aiProvider } from '#server/utils/ai/provider.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { decryptSecret } from '#server/utils/crypto.ts'
import { ApiError } from '#server/utils/errors.ts'
import { draftFunderReply } from '#server/utils/mail/draft-reply.ts'
import { GmailMailbox } from '#server/utils/mail/gmail.ts'
import { DraftReplyRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Email'],
        summary: 'Draft an email to a funder',
        description:
            "AI drafts a reply to the latest thread with this funder in your Gmail (or a new email when there is none), using the pipeline record and Earth Bank's Drive documents. The thread is read live and not stored. Nothing is saved or sent: edit the draft, then save it to Gmail with POST /v1/mailbox/drafts.",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DraftReplyRequest' } } },
        },
        responses: {
            200: {
                description: 'The draft',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/ReplyDraft' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const funderId = getRouterParam(event, 'id') ?? ''
    const body = await parseBody({ event, schema: DraftReplyRequest })
    const ai = aiProvider()
    if (!ai) {
        throw new ApiError({
            status: 409,
            code: 'ai_not_configured',
            message: 'Drafting needs the Anthropic API key (ANTHROPIC_API_KEY).',
        })
    }
    const connection = await findMailboxConnectionForUser({ userId: ctx.user.id })
    const refreshToken = connection ? decryptSecret({ encrypted: connection.refresh_token_encrypted }) : null
    if (!connection || connection.status !== 'active' || !refreshToken) {
        throw new ApiError({
            status: 409,
            code: 'gmail_not_connected',
            message: 'Connect your Gmail in Settings → Email so the AI can read the thread.',
        })
    }
    const draft = await draftFunderReply({
        funderId,
        opportunityId: body.opportunity_id ?? null,
        guidance: body.guidance ?? null,
        author: { name: ctx.user.name, email: connection.google_email },
        mailbox: new GmailMailbox({ refreshToken }),
        ai,
        now: new Date(),
    })
    // Only the fact that a draft was made; never its content.
    await recordAudit({
        actor: ctx.actor,
        action: 'email_draft.generated',
        entityType: 'funder',
        entityId: funderId,
        changes: { opportunity_id: body.opportunity_id ?? null, has_thread: draft.thread !== null },
        ip: requestIp({ event }),
    })
    return draft
})
