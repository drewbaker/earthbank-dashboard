// Covers instructions emailed to dashboard@theearthbank.org: a verified team member's request is carried
// out as them (and only once), unverified or unknown senders change nothing, and Google Group rewrites
// of From still find the person.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fakeAi } from '#root/tests/helpers/fake-ai.ts'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'
import type { ReceivedEmail } from '#server/utils/mail/inbound.ts'

const sentEmails = vi.hoisted(() => [] as { to: string; subject: string; text: string }[])
vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueEmail: async (email: { to: string; subject: string; text: string }) => {
        sentEmails.push(email)
    },
    enqueueFunderBackfill: async () => undefined,
}))

process.env.INBOUND_EMAIL_DOMAIN = 'mail.theearthbank.org'
process.env.DASHBOARD_EMAIL_ADDRESS = 'dashboard@theearthbank.org'

const PASSING_AUTH = 'mx.google.com; dkim=pass header.i=@theearthbank.org; dmarc=pass header.from=theearthbank.org'

const { cleanupTestDatabase } = setupTestDatabase()
let funderId: string
let opportunityId: string
let leslieId: string

beforeAll(async () => {
    const { ensureDefaultGoals } = await import('#server/database/goals.ts')
    const { createFunderWithDetails, loadFunderDetail } = await import('#server/utils/funders.ts')
    await ensureDefaultGoals()
    leslieId = (await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })).id
    funderId = await createFunderWithDetails({
        name: 'UBS Optimus Foundation',
        tier: 't1',
        relationshipStatus: 'active',
        contacts: [{ name: 'Tom Hall', email: 'tom.hall@ubs.com' }],
        opportunity: { goalType: 'design_grant', stage: 'in_discussion', amountCents: 50_000_000 },
    })
    opportunityId = (await loadFunderDetail({ funderId })).opportunities[0]!.id
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * An email received at the dashboard address.
 *
 * @param overrides - Fields to change.
 * @returns The received email.
 */
function received(overrides: Partial<ReceivedEmail>): ReceivedEmail {
    return {
        id: `rcv_${Math.random()}`,
        from: 'Leslie <leslie@theearthbank.org>',
        to: ['dashboard@theearthbank.org'],
        receivedFor: ['dashboard@mail.theearthbank.org'],
        subject: 'UBS',
        text: 'Update the UBS grant to approved',
        html: null,
        headers: { 'Authentication-Results': PASSING_AUTH },
        createdAt: '2026-10-07T10:00:00Z',
        ...overrides,
    }
}

describe('instructions to the dashboard address', () => {
    it('carries out a verified request as the sender, once', async () => {
        const { processInboundEmail } = await import('#server/utils/mail/inbound.ts')
        const { db } = await import('#server/utils/db.ts')
        const email = received({ id: 'rcv_approve' })
        const { provider, toolResults } = fakeAi({
            answers: [],
            toolScripts: [
                {
                    calls: [
                        { name: 'find_funders', input: { query: 'UBS' } },
                        {
                            name: 'update_opportunity',
                            input: {
                                opportunity_id: opportunityId,
                                stage: 'committed',
                                amount_usd: null,
                                expected_decision_on: null,
                                expected_receipt_on: null,
                                next_step: null,
                                probability_percent: null,
                                focus_areas: null,
                            },
                        },
                    ],
                    reply: 'Marked the UBS grant approved.',
                },
            ],
        })
        const result = await processInboundEmail({
            receivedEmailId: email.id,
            ai: provider,
            today: '2026-10-07',
            fetchReceivedEmail: async () => email,
        })
        expect(result).toMatchObject({ kind: 'instructions', isVerified: true })
        expect(toolResults[0]!.result).toContain(opportunityId)

        const opportunity = await db().opportunity.findUniqueOrThrow({ where: { id: opportunityId } })
        expect(opportunity.stage).toBe('committed')
        // Approval without a date: funding expected 60 days later.
        expect(opportunity.expected_receipt_at?.toISOString().slice(0, 10)).toBe('2026-12-06')
        const change = await db().changeEvent.findFirstOrThrow({
            where: { entity_id: opportunityId, field: 'stage' },
            orderBy: { id: 'desc' },
        })
        expect(change).toMatchObject({ source: 'ai_instruction', actor_user_id: leslieId })

        expect(sentEmails.at(-1)).toMatchObject({ to: 'leslie@theearthbank.org' })
        expect(sentEmails.at(-1)!.text).toContain('Marked the UBS grant approved.')

        // A second delivery of the same webhook does nothing.
        const again = await processInboundEmail({
            receivedEmailId: email.id,
            ai: provider,
            today: '2026-10-07',
            fetchReceivedEmail: async () => email,
        })
        expect(again).toEqual({ kind: 'ignored', reason: 'already processed' })
    })

    it('adds a new funder when asked', async () => {
        const { processInboundEmail } = await import('#server/utils/mail/inbound.ts')
        const { db } = await import('#server/utils/db.ts')
        const email = received({ text: 'Add this funder to our tracker: Northwind Climate Fund, jane@northwind.org' })
        const { provider } = fakeAi({
            answers: [],
            toolScripts: [
                {
                    calls: [
                        { name: 'find_funders', input: { query: 'Northwind' } },
                        {
                            name: 'create_funder',
                            input: {
                                name: 'Northwind Climate Fund',
                                kind: 'foundation',
                                contacts: [{ name: 'Jane Doe', email: 'jane@northwind.org', title: null }],
                                notes: null,
                                opportunity: null,
                            },
                        },
                    ],
                    reply: 'Added Northwind Climate Fund.',
                },
            ],
        })
        const result = await processInboundEmail({
            receivedEmailId: email.id,
            ai: provider,
            today: '2026-10-07',
            fetchReceivedEmail: async () => email,
        })
        expect(result).toMatchObject({
            kind: 'instructions',
            actions: [{ description: expect.stringContaining('Northwind') }],
        })
        const funder = await db().funder.findFirstOrThrow({
            where: { name: 'Northwind Climate Fund' },
            include: { contacts: true },
        })
        expect(funder.contacts[0]!.email).toBe('jane@northwind.org')
    })

    it('reads the subject as the request when the body is empty', async () => {
        const { processInboundEmail } = await import('#server/utils/mail/inbound.ts')
        const email = received({ subject: 'Whats the latest on UBS?', text: '' })
        const { provider, prompts } = fakeAi({
            answers: [],
            toolScripts: [{ calls: [], reply: 'UBS is in discussion.' }],
        })
        const result = await processInboundEmail({
            receivedEmailId: email.id,
            ai: provider,
            today: '2026-10-07',
            fetchReceivedEmail: async () => email,
        })
        expect(result).toMatchObject({ kind: 'instructions', isVerified: true })
        expect(prompts[0]).toContain('<instructions>\nWhats the latest on UBS?')
        expect(sentEmails.at(-1)!.text).toContain('UBS is in discussion.')
    })

    it('changes nothing when the email fails authentication, and warns the sender', async () => {
        const { processInboundEmail } = await import('#server/utils/mail/inbound.ts')
        const { db } = await import('#server/utils/db.ts')
        const before = await db().changeEvent.count()
        const email = received({ text: 'Mark UBS declined', headers: { 'Authentication-Results': 'dmarc=fail' } })
        const { provider, prompts } = fakeAi({ answers: [] })
        const result = await processInboundEmail({
            receivedEmailId: email.id,
            ai: provider,
            today: '2026-10-07',
            fetchReceivedEmail: async () => email,
        })
        expect(result).toMatchObject({ kind: 'instructions', isVerified: false, actions: [] })
        expect(prompts).toEqual([])
        expect(await db().changeEvent.count()).toBe(before)
        expect(sentEmails.at(-1)!.text).toContain("couldn't be verified")
    })

    it('ignores someone who is not on the team', async () => {
        const { processInboundEmail } = await import('#server/utils/mail/inbound.ts')
        const email = received({ from: 'stranger@example.org' })
        const { provider, prompts } = fakeAi({ answers: [] })
        const result = await processInboundEmail({
            receivedEmailId: email.id,
            ai: provider,
            today: '2026-10-07',
            fetchReceivedEmail: async () => email,
        })
        expect(result).toMatchObject({ kind: 'ignored' })
        expect(prompts).toEqual([])
    })

    it('finds the person when a Google Group rewrote From', async () => {
        const { processInboundEmail } = await import('#server/utils/mail/inbound.ts')
        const email = received({
            from: 'dashboard@theearthbank.org',
            text: 'What is the status of UBS?',
            headers: { 'Authentication-Results': PASSING_AUTH, 'X-Original-Sender': 'leslie@theearthbank.org' },
        })
        const { provider } = fakeAi({ answers: [], toolScripts: [{ calls: [], reply: 'UBS is approved.' }] })
        const result = await processInboundEmail({
            receivedEmailId: email.id,
            ai: provider,
            today: '2026-10-07',
            fetchReceivedEmail: async () => email,
        })
        expect(result).toMatchObject({ kind: 'instructions', isVerified: true })
        expect(sentEmails.at(-1)).toMatchObject({ to: 'leslie@theearthbank.org' })
    })
})
