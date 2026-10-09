// Covers how email updates the pipeline: confident changes apply, risky or unsure ones wait for review,
// manual edits win, bodies are never stored, sensitive subjects are hidden, forwarded intros create
// draft funders, and the inbound webhook rejects bad signatures.
import { createHmac } from 'node:crypto'
import { createApp, createRouter, toWebHandler } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fakeAi } from '#root/tests/helpers/fake-ai.ts'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'
import type { IncomingEmail } from '#server/utils/mail/types.ts'

const queuedForwards = vi.hoisted(() => [] as string[])
vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueEmail: async () => undefined,
    enqueueFunderBackfill: async () => undefined,
    enqueueForwardedEmail: async ({ receivedEmailId }: { receivedEmailId: string }) => {
        queuedForwards.push(receivedEmailId)
    },
}))

const WEBHOOK_SECRET = `whsec_${Buffer.from('test-webhook-secret-32-bytes!!!!').toString('base64')}`
process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET
process.env.INBOUND_EMAIL_DOMAIN = 'in.theearthbank.org'

const { cleanupTestDatabase } = setupTestDatabase()
let funderId: string
let designGrantId: string
let userId: string

beforeAll(async () => {
    const { ensureDefaultGoals } = await import('#server/database/goals.ts')
    const { createFunderWithDetails, loadFunderDetail } = await import('#server/utils/funders.ts')
    await ensureDefaultGoals()
    userId = (await createTestUser({ email: 'drew@theearthbank.org', name: 'Drew' })).id
    funderId = await createFunderWithDetails({
        name: 'UBS Optimus Foundation',
        tier: 't1',
        relationshipStatus: 'active',
        contacts: [{ name: 'Tom Hall', email: 'tom-za.hall@ubs.com' }],
        opportunity: { goalType: 'design_grant', stage: 'in_discussion', amountCents: 50_000_000 },
    })
    designGrantId = (await loadFunderDetail({ funderId })).opportunities[0]!.id
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * A test email.
 *
 * @param overrides - Fields to change.
 * @returns The email.
 */
function email(overrides: Partial<IncomingEmail>): IncomingEmail {
    return {
        messageIdHeader: `<${Math.random()}@ubs.com>`,
        from: 'tom-za.hall@ubs.com',
        to: ['drew@theearthbank.org'],
        cc: [],
        sentAt: new Date('2026-10-05T15:00:00Z'),
        subject: 'Design grant',
        text: 'Board approved the $500k design grant; funds will land by Jan 15.',
        ...overrides,
    }
}

/**
 * A classification answer with sensible defaults.
 *
 * @param overrides - Fields to change.
 * @returns The answer.
 */
function classification(overrides: Record<string, unknown>) {
    return {
        is_relevant: true,
        is_sensitive: false,
        summary: 'UBS approved the $500k design grant, landing by Jan 15.',
        reason: 'Tom says the board approved it.',
        confidence: 0.95,
        last_contact_on: '2026-10-05',
        relationship_status: 'committed',
        opportunity_updates: [],
        new_contacts: [],
        ...overrides,
    }
}

describe('processFunderEmail', () => {
    it('applies confident changes and records the evidence without the body', async () => {
        const { processFunderEmail } = await import('#server/utils/mail/classify.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        const { db } = await import('#server/utils/db.ts')
        const { provider, prompts } = fakeAi({
            answers: [
                classification({
                    opportunity_updates: [
                        {
                            opportunity_id: designGrantId,
                            stage: 'committed',
                            amount_usd: 500_000,
                            expected_decision_on: null,
                            expected_receipt_on: '2027-01-15',
                            next_step: 'Send grant agreement',
                            confidence: 0.93,
                            reason: 'Board approved.',
                        },
                    ],
                    new_contacts: [
                        { name: 'Clarissa Mayer', email: 'clarissa.mayer@ubs.com', title: 'Program officer' },
                    ],
                }),
            ],
        })
        const result = await processFunderEmail({
            email: email({}),
            funderId,
            source: 'gmail',
            mailboxUserId: userId,
            ai: provider,
        })

        // Last contact, relationship, stage, expected receipt and next step; the amount was already $500k.
        expect(result).toMatchObject({ status: 'processed', applied: 5, pending: 0 })
        expect(prompts[0]).toContain('Board approved the $500k design grant')
        expect(prompts[0]).toContain(designGrantId)
        const opportunity = await findOpportunity({ opportunityId: designGrantId })
        expect(opportunity).toMatchObject({ stage: 'committed', next_step: 'Send grant agreement' })
        expect(opportunity!.expected_receipt_at?.toISOString().slice(0, 10)).toBe('2027-01-15')

        const evidence = await db().emailEvidence.findFirstOrThrow({ where: { funder_id: funderId } })
        expect(evidence).toMatchObject({ subject: 'Design grant', is_relevant: true })
        expect(JSON.stringify(evidence)).not.toContain('funds will land by Jan 15')
        expect(await db().contact.findUnique({ where: { email: 'clarissa.mayer@ubs.com' } })).not.toBeNull()
    })

    it('holds back unsure changes, a move to lost and a lower amount for review', async () => {
        const { processFunderEmail } = await import('#server/utils/mail/classify.ts')
        const { listChangeEventRows } = await import('#server/database/change-events.ts')
        const { provider } = fakeAi({
            answers: [
                classification({
                    relationship_status: null,
                    opportunity_updates: [
                        {
                            opportunity_id: designGrantId,
                            stage: 'lost',
                            amount_usd: 300_000,
                            expected_decision_on: null,
                            expected_receipt_on: null,
                            next_step: 'Ask why',
                            confidence: 0.9,
                            reason: 'Sounds like a no.',
                        },
                    ],
                }),
            ],
        })
        const result = await processFunderEmail({
            email: email({ sentAt: new Date('2026-10-06T15:00:00Z') }),
            funderId,
            source: 'gmail',
            mailboxUserId: userId,
            ai: provider,
        })
        // next_step applies (last contact didn't move forward); stage → lost and the lower amount wait.
        expect(result).toMatchObject({ status: 'processed', applied: 1, pending: 2 })
        const pending = await listChangeEventRows({ entityIds: [designGrantId], status: 'pending', limit: 10 })
        expect(pending.map(event => event.field).sort()).toEqual(['amount_cents', 'stage'])
    })

    it('never overrides a field someone edited after the email was sent', async () => {
        const { processFunderEmail } = await import('#server/utils/mail/classify.ts')
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: designGrantId,
            changes: { next_step: 'Drew owns this' },
            source: 'manual',
            actorUserId: userId,
        })
        const { provider } = fakeAi({
            answers: [
                classification({
                    relationship_status: null,
                    opportunity_updates: [
                        {
                            opportunity_id: designGrantId,
                            stage: null,
                            amount_usd: null,
                            expected_decision_on: null,
                            expected_receipt_on: null,
                            next_step: 'Old suggestion from an older email',
                            confidence: 0.99,
                            reason: 'Older email.',
                        },
                    ],
                }),
            ],
        })
        await processFunderEmail({
            email: email({ sentAt: new Date('2026-09-01T00:00:00Z') }),
            funderId,
            source: 'gmail',
            mailboxUserId: userId,
            ai: provider,
        })
        expect((await findOpportunity({ opportunityId: designGrantId }))!.next_step).toBe('Drew owns this')
    })

    it('hides the subject of a sensitive email and skips the same email in another inbox', async () => {
        const { processFunderEmail } = await import('#server/utils/mail/classify.ts')
        const { db } = await import('#server/utils/db.ts')
        const sensitive = email({ messageIdHeader: '<sensitive@ubs.com>', subject: 'Personal: family news' })
        const { provider } = fakeAi({
            answers: [
                classification({
                    is_relevant: false,
                    is_sensitive: true,
                    summary: 'Personal note; no funding update.',
                    relationship_status: null,
                }),
            ],
        })
        await processFunderEmail({ email: sensitive, funderId, source: 'gmail', mailboxUserId: userId, ai: provider })
        const evidence = await db().emailEvidence.findUniqueOrThrow({
            where: { message_id_header: '<sensitive@ubs.com>' },
        })
        expect(evidence).toMatchObject({
            subject: null,
            is_sensitive: true,
            summary: 'Personal note; no funding update.',
        })

        const again = await processFunderEmail({
            email: sensitive,
            funderId,
            source: 'gmail',
            mailboxUserId: userId,
            ai: provider,
        })
        expect(again).toEqual({ status: 'already_processed' })
    })
})

describe('forwarded email', () => {
    it('drafts a new funder from an unknown sender', async () => {
        const { processForwardedEmail, regenerateForwardingAddress } = await import('#server/utils/mail/inbound.ts')
        const { db } = await import('#server/utils/db.ts')
        const address = await regenerateForwardingAddress({ userId })
        const { provider } = fakeAi({
            answers: [
                {
                    is_funder: true,
                    organization_name: 'Northwind Climate Fund',
                    kind: 'foundation',
                    contact_name: 'Jane Doe',
                    contact_title: 'Director',
                    goal_type: 'design_grant',
                    amount_usd: 250_000,
                    summary: 'Northwind wants to discuss a $250k design grant.',
                    next_step: null,
                },
            ],
        })
        const result = await processForwardedEmail({
            receivedEmailId: 'rcv_1',
            ai: provider,
            fetchReceivedEmail: async () => ({
                id: 'rcv_1',
                from: 'drew.personal@gmail.com',
                to: [address],
                receivedFor: [address],
                subject: 'Fwd: Earth Bank',
                text: 'FYI\n\n---------- Forwarded message ---------\nFrom: Jane Doe <jane@northwind.org>\nDate: Tue, Oct 6, 2026 at 4:12 PM\nSubject: Earth Bank\nTo: <drew.personal@gmail.com>\n\nWe would love to talk about a $250k grant.',
                html: null,
                createdAt: '2026-10-07T10:00:00Z',
            }),
        })
        expect(result).toMatchObject({ status: 'draft_funder_created' })
        const draft = await db().funder.findFirstOrThrow({
            where: { name: 'Northwind Climate Fund' },
            include: { contacts: true, opportunities: true },
        })
        expect(draft).toMatchObject({ status: 'draft', email_domains: ['northwind.org'] })
        expect(draft.contacts[0]).toMatchObject({ email: 'jane@northwind.org', name: 'Jane Doe' })
        expect(draft.opportunities[0]!.amount_cents).toBe(25_000_000n)
    })

    it('ignores mail to an address that was replaced', async () => {
        const { processForwardedEmail, regenerateForwardingAddress } = await import('#server/utils/mail/inbound.ts')
        const oldAddress = await regenerateForwardingAddress({ userId })
        await regenerateForwardingAddress({ userId })
        const { provider } = fakeAi({ answers: [] })
        const result = await processForwardedEmail({
            receivedEmailId: 'rcv_2',
            ai: provider,
            fetchReceivedEmail: async () => ({
                id: 'rcv_2',
                from: 'someone@example.org',
                to: [oldAddress],
                receivedFor: [oldAddress],
                subject: 'Hi',
                text: 'Hello',
                html: null,
                createdAt: '2026-10-07T10:00:00Z',
            }),
        })
        expect(result).toBeNull()
    })
})

describe('inbound webhook', () => {
    let callWebhook: (request: Request) => Promise<Response>

    beforeAll(async () => {
        const { default: handler } = await import('#server/routes/webhooks/inbound-email.post.ts')
        const app = createApp()
        app.use(createRouter().post('/webhooks/inbound-email', handler))
        callWebhook = toWebHandler(app)
    })

    /**
     * Post a webhook, signed the way Resend (Standard Webhooks) signs it.
     *
     * @param input.body - JSON body.
     * @param input.secret - Signing secret (wrong to test rejection).
     * @returns The response.
     */
    function postWebhook({ body, secret = WEBHOOK_SECRET }: { body: string; secret?: string }) {
        const id = 'msg_test'
        const timestamp = String(Math.floor(Date.now() / 1000))
        const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
        const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
        return callWebhook(
            new Request('http://localhost:3000/webhooks/inbound-email', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'svix-id': id,
                    'svix-timestamp': timestamp,
                    'svix-signature': `v1,${signature}`,
                },
                body,
            }),
        )
    }

    it('queues a received email when the signature verifies', async () => {
        const response = await postWebhook({
            body: JSON.stringify({
                type: 'email.received',
                created_at: new Date().toISOString(),
                data: { email_id: 'rcv_99' },
            }),
        })
        expect(response.status).toBe(200)
        expect(queuedForwards).toContain('rcv_99')
    })

    it('rejects a bad signature', async () => {
        const wrongSecret = `whsec_${Buffer.from('a-different-secret-of-32-bytes!!').toString('base64')}`
        const response = await postWebhook({
            body: JSON.stringify({ type: 'email.received', data: { email_id: 'rcv_bad' } }),
            secret: wrongSecret,
        })
        expect(response.status).toBe(400)
        expect(queuedForwards).not.toContain('rcv_bad')
    })
})
