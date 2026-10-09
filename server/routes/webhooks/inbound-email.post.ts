import { defineEventHandler, getRequestHeader, readRawBody, setResponseStatus } from 'h3'
import { Resend } from 'resend'
import { config } from '#server/utils/config.ts'
import { enqueueForwardedEmail } from '#server/utils/jobs/enqueue.ts'

// Resend calls this when an email reaches the inbound domain. The signature is checked against the
// raw body (re-serialized JSON would break it); only the email's id is queued, never its content.
export default defineEventHandler(async event => {
    if (!config.resendWebhookSecret) {
        setResponseStatus(event, 503)
        return { error: { code: 'inbound_not_configured', message: 'RESEND_WEBHOOK_SECRET is not set.' } }
    }
    const payload = (await readRawBody(event, 'utf8')) ?? ''
    let webhookEvent
    try {
        webhookEvent = new Resend(config.resendApiKey || 're_unused').webhooks.verify({
            payload,
            headers: {
                id: getRequestHeader(event, 'svix-id') ?? '',
                timestamp: getRequestHeader(event, 'svix-timestamp') ?? '',
                signature: getRequestHeader(event, 'svix-signature') ?? '',
            },
            webhookSecret: config.resendWebhookSecret,
        })
    } catch {
        setResponseStatus(event, 400)
        return { error: { code: 'invalid_signature', message: 'Webhook signature did not verify.' } }
    }
    if (webhookEvent.type === 'email.received') {
        await enqueueForwardedEmail({ receivedEmailId: webhookEvent.data.email_id })
    }
    return { received: true }
})
