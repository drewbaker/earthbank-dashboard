import { setResponseStatus } from 'h3'
import { defineRouteMeta } from 'nitropack/runtime'
import { findFunder } from '#server/database/funders.ts'
import { findMailboxConnectionForUser } from '#server/database/mailboxes.ts'
import { defineApiHandler, parseBody, requestIp } from '#server/utils/api.ts'
import { recordAudit } from '#server/utils/audit.ts'
import { requireUser } from '#server/utils/auth.ts'
import { hasGoogleScope } from '#server/utils/auth/google.ts'
import { decryptSecret } from '#server/utils/crypto.ts'
import { ApiError, notFound } from '#server/utils/errors.ts'
import { buildDraftMessage } from '#server/utils/mail/compose.ts'
import { GmailMailbox } from '#server/utils/mail/gmail.ts'
import { CreateGmailDraftRequest } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Email'],
        summary: 'Save an email draft to my Gmail',
        description:
            'Saves the email as a draft in your Gmail, in the original thread when replying. It is never sent from here: open it in Gmail, check it and send it yourself.',
        requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateGmailDraftRequest' } } },
        },
        responses: {
            201: {
                description: 'Draft saved',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/GmailDraft' } } },
            },
        },
    },
})

export default defineApiHandler(async event => {
    const { ctx } = requireUser({ event })
    const body = await parseBody({ event, schema: CreateGmailDraftRequest })
    if (!(await findFunder({ funderId: body.funder_id }))) {
        throw notFound({ resource: 'Funder' })
    }
    const connection = await findMailboxConnectionForUser({ userId: ctx.user.id })
    const refreshToken = connection ? decryptSecret({ encrypted: connection.refresh_token_encrypted }) : null
    if (!connection || connection.status !== 'active' || !refreshToken) {
        throw new ApiError({
            status: 409,
            code: 'gmail_not_connected',
            message: 'Connect your Gmail in Settings → Email first.',
        })
    }
    if (!hasGoogleScope({ grantedScopes: connection.scopes, scope: 'gmail.compose' })) {
        throw new ApiError({
            status: 409,
            code: 'gmail_reconnect_required',
            message: 'Reconnect Gmail in Settings → Email to allow saving drafts. Until then, copy the text.',
        })
    }
    const raw = buildDraftMessage({
        from: connection.google_email,
        to: body.to,
        cc: body.cc,
        subject: body.subject,
        body: body.body,
        inReplyTo: body.in_reply_to ?? null,
        references: body.references ?? null,
    })
    const draft = await new GmailMailbox({ refreshToken }).createDraft({ raw, threadId: body.gmail_thread_id ?? null })
    await recordAudit({
        actor: ctx.actor,
        action: 'email_draft.saved',
        entityType: 'funder',
        entityId: body.funder_id,
        changes: { gmail_draft_id: draft.draftId, recipient_count: body.to.length + body.cc.length },
        ip: requestIp({ event }),
    })
    setResponseStatus(event, 201)
    const account = encodeURIComponent(connection.google_email)
    return {
        gmail_draft_id: draft.draftId,
        open_url: draft.messageId
            ? `https://mail.google.com/mail/u/${account}/#drafts?compose=${draft.messageId}`
            : `https://mail.google.com/mail/u/${account}/#drafts`,
    }
})
