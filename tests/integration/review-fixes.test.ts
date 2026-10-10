// Regression tests for issues found in review: sync never drops older mail, staff addresses never
// become funder contacts, re-imports keep dashboard and AI edits, revert never undoes a later edit,
// accept records a null "from" correctly, and mid-month burn changes are pro-rated.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fakeAi } from '#root/tests/helpers/fake-ai.ts'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'
import type { MailboxReader } from '#server/utils/mail/sync.ts'

vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueEmail: async () => undefined,
    enqueueFunderBackfill: async () => undefined,
}))

const { cleanupTestDatabase } = setupTestDatabase()
let funderId: string
let opportunityId: string
let userId: string

beforeAll(async () => {
    const { ensureDefaultGoals } = await import('#server/database/goals.ts')
    const { createFunderWithDetails, loadFunderDetail } = await import('#server/utils/funders.ts')
    await ensureDefaultGoals()
    userId = (await createTestUser({ email: 'steve@theearthbank.org', name: 'Steve' })).id
    funderId = await createFunderWithDetails({
        name: 'Rockefeller Foundation',
        tier: 't1',
        contacts: [{ name: 'Carli Roth', email: 'croth@rockfound.org' }],
        opportunity: { goalType: 'design_grant', stage: 'in_discussion', amountCents: 25_000_000 },
    })
    opportunityId = (await loadFunderDetail({ funderId })).opportunities[0]!.id
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * A classification answer that only notes contact.
 *
 * @param input.sentOn - YYYY-MM-DD.
 * @returns The answer.
 */
function noteContact({ sentOn }: { sentOn: string }) {
    return {
        is_relevant: true,
        is_sensitive: false,
        summary: 'Check-in.',
        reason: 'Routine.',
        confidence: 0.9,
        last_contact_on: sentOn,
        relationship_status: null,
        opportunity_updates: [],
        new_contacts: [],
    }
}

describe('mailbox sync', () => {
    it('reads the oldest unread mail first and resumes from what it could not get to', async () => {
        const { syncMailbox } = await import('#server/utils/mail/sync.ts')
        const { db } = await import('#server/utils/db.ts')
        const { newId } = await import('#server/utils/ids.ts')
        const connection = await db().mailboxConnection.create({
            data: {
                id: newId({ kind: 'mailboxConnection' }),
                user_id: userId,
                google_email: 'steve@theearthbank.org',
                refresh_token_encrypted: (await import('#server/utils/crypto.ts')).encryptSecret({
                    plaintext: 'refresh',
                }),
                scopes: 'gmail.readonly',
            },
        })
        const days = ['2026-09-01', '2026-09-05', '2026-09-10']
        const searchQueries: string[] = []
        const mailbox: MailboxReader = {
            async searchMessageIds({ query }) {
                searchQueries.push(query)
                // Gmail returns newest first.
                return ['g3', 'g2', 'g1', 'g-staff']
            },
            async getMessageHeaders({ gmailId }) {
                if (gmailId === 'g-staff') {
                    return {
                        gmailId,
                        messageIdHeader: '<staff>',
                        from: 'leslie@theearthbank.org',
                        recipients: ['drew@theearthbank.org'],
                        sentAt: new Date('2026-09-02'),
                    }
                }
                const index = Number(gmailId.slice(1)) - 1
                return {
                    gmailId,
                    messageIdHeader: `<${gmailId}@rockfound.org>`,
                    from: 'croth@rockfound.org',
                    recipients: ['steve@theearthbank.org'],
                    sentAt: new Date(days[index]!),
                }
            },
            async getMessage({ gmailId }) {
                const index = Number(gmailId.slice(1)) - 1
                return {
                    messageIdHeader: `<${gmailId}@rockfound.org>`,
                    from: 'croth@rockfound.org',
                    to: ['steve@theearthbank.org'],
                    cc: [],
                    sentAt: new Date(days[index]!),
                    subject: 'Hi',
                    text: 'Hello',
                }
            },
        }
        const { provider } = fakeAi({ answers: days.map(sentOn => noteContact({ sentOn })) })
        const now = new Date('2026-10-01T00:00:00Z')

        const first = await syncMailbox({ connection, ai: provider, now, mailbox, maxMessagesPerRun: 2 })
        expect(first).toMatchObject({ matched: 3, processed: 2 })
        const afterFirst = await db().mailboxConnection.findUniqueOrThrow({ where: { id: connection.id } })
        // Resumes from the third (oldest unread) email rather than "now".
        expect(afterFirst.last_synced_at?.toISOString()).toBe('2026-09-10T00:00:00.000Z')
        expect(searchQueries[0]).not.toContain('theearthbank.org')

        const progress: string[] = []
        const second = await syncMailbox({
            connection: afterFirst,
            ai: provider,
            now,
            mailbox,
            maxMessagesPerRun: 2,
            onProgress: async ({ phase, done, total }) => {
                progress.push(`${phase} ${done}/${total}`)
            },
        })
        expect(second).toMatchObject({ matched: 1, processed: 1 })
        // Settings → Email shows each step: searching Gmail, checking headers, reading funder email.
        expect(progress).toEqual(['searching 0/1', 'searching 1/1', 'checking 0/4', 'reading 0/1'])
        const evidence = await db().emailEvidence.findMany({
            where: { funder_id: funderId },
            orderBy: { sent_at: 'asc' },
        })
        expect(evidence.map(row => row.message_id_header)).toEqual([
            '<g1@rockfound.org>',
            '<g2@rockfound.org>',
            '<g3@rockfound.org>',
        ])
    })
})

describe('staff addresses', () => {
    it('never become funder contacts or funder domains', async () => {
        const { addContactToFunder } = await import('#server/utils/contacts.ts')
        const { findFunder } = await import('#server/database/funders.ts')
        await expect(
            addContactToFunder({ funderId, name: 'Leslie', email: 'leslie@theearthbank.org', source: 'manual' }),
        ).rejects.toThrow('Earth Bank addresses')
        await expect(
            addContactToFunder({ funderId, name: 'Leslie', email: 'leslie@resolvefund.org', source: 'manual' }),
        ).rejects.toThrow('Earth Bank addresses')
        expect((await findFunder({ funderId }))!.email_domains).toEqual(['rockfound.org'])
    })

    it("aren't added when the AI lists people from other organizations", async () => {
        const { processFunderEmail } = await import('#server/utils/mail/classify.ts')
        const { db } = await import('#server/utils/db.ts')
        const { provider } = fakeAi({
            answers: [
                {
                    ...noteContact({ sentOn: '2026-09-20' }),
                    new_contacts: [
                        { name: 'Thomas Belazis', email: 'tbelazis@rockfound.org', title: null },
                        { name: 'Someone Else', email: 'someone@otherfund.org', title: null },
                        { name: 'Drew', email: 'drew@theearthbank.org', title: null },
                    ],
                },
            ],
        })
        await processFunderEmail({
            email: {
                messageIdHeader: '<contacts@rockfound.org>',
                from: 'croth@rockfound.org',
                to: ['drew@theearthbank.org'],
                cc: ['someone@otherfund.org'],
                sentAt: new Date('2026-09-20'),
                subject: 'Intro',
                text: 'Meet Thomas',
            },
            funderId,
            source: 'gmail',
            mailboxUserId: userId,
            ai: provider,
        })
        const contacts = await db().contact.findMany({ where: { funder_id: funderId }, orderBy: { name: 'asc' } })
        expect(contacts.map(contact => contact.email)).toEqual(['croth@rockfound.org', 'tbelazis@rockfound.org'])
    })

    it('a note with no forwarded email goes to the assistant as instructions, not to funder matching', async () => {
        const { processForwardedEmail } = await import('#server/utils/mail/inbound.ts')
        const { provider, prompts } = fakeAi({ answers: [] })
        const result = await processForwardedEmail({
            receivedEmailId: 'rcv_plain',
            ai: provider,
            today: '2026-10-01',
            fetchReceivedEmail: async () => ({
                id: 'rcv_plain',
                from: 'steve@theearthbank.org',
                to: ['dashboard@theearthbank.org'],
                receivedFor: ['dashboard@mail.theearthbank.org'],
                subject: 'note',
                text: 'Just a note to myself',
                html: null,
                headers: {
                    'Authentication-Results':
                        'mx.google.com; dkim=pass header.i=@theearthbank.org; dmarc=pass header.from=theearthbank.org',
                },
                createdAt: '2026-10-01T00:00:00Z',
            }),
        })
        // Read as instructions; with nothing to do, nothing is attributed to the person who sent it.
        expect(result).toMatchObject({ kind: 'instructions', actions: [] })
        expect(prompts[0]).toContain('Just a note to myself')
        const { db } = await import('#server/utils/db.ts')
        expect(await db().contact.count({ where: { email: 'steve@theearthbank.org' } })).toBe(0)
    })
})

describe('change log', () => {
    it('refuses to revert a change when the field has changed since', async () => {
        const { applyFieldChanges, revertChangeEvent } = await import('#server/utils/change-events.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        const [aiChange] = await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { stage: 'proposal' },
            source: 'ai_email',
        })
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { stage: 'committed' },
            source: 'manual',
            actorUserId: userId,
        })
        await expect(revertChangeEvent({ changeEventId: aiChange!.id, actorUserId: userId })).rejects.toThrow(
            'changed since',
        )
        expect((await findOpportunity({ opportunityId }))!.stage).toBe('committed')
    })

    it('records a null "from" when accepting a change to an empty field', async () => {
        const { acceptChangeEvent, applyFieldChanges, revertChangeEvent } =
            await import('#server/utils/change-events.ts')
        const { findChangeEvent } = await import('#server/database/change-events.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { next_step: 'Old step' },
            source: 'manual',
            actorUserId: userId,
        })
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { next_step: null },
            source: 'manual',
            actorUserId: userId,
        })
        const [pending] = await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { next_step: 'AI step' },
            source: 'ai_email',
            status: 'pending',
        })
        await acceptChangeEvent({ changeEventId: pending!.id, actorUserId: userId })
        expect((await findChangeEvent({ changeEventId: pending!.id }))!.from_value).toBeNull()
        await revertChangeEvent({ changeEventId: pending!.id, actorUserId: userId })
        expect((await findOpportunity({ opportunityId }))!.next_step).toBeNull()
    })
})

describe('spreadsheet re-import', () => {
    it('keeps AI updates and never clears a field from a blank cell', async () => {
        const { importMasterPipeline } = await import('#server/utils/pipeline-import/import-master-pipeline.ts')
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const { findFunder } = await import('#server/database/funders.ts')
        await applyFieldChanges({
            entityType: 'funder',
            entityId: funderId,
            changes: { relationship_status: 'advanced', geo_focus: 'EM' },
            source: 'ai_email',
        })
        await importMasterPipeline({
            importedOn: new Date('2026-10-02'),
            funders: [
                {
                    name: 'Rockefeller Foundation',
                    nameKey: 'rockefeller foundation',
                    kind: 'foundation',
                    tier: 't1',
                    relationshipStatus: 'active',
                    geoFocus: null,
                    potentialSize: 'Above $10M',
                    materialsSent: false,
                    lastContactAt: null,
                    lastContactNote: null,
                    notes: null,
                    contacts: [{ name: 'Leslie', title: null, email: 'leslie@theearthbank.org', notes: null }],
                    opportunities: [],
                    sheetRows: [8],
                },
            ],
        })
        const funder = await findFunder({ funderId })
        expect(funder).toMatchObject({ relationship_status: 'advanced', geo_focus: 'EM', potential_size: 'Above $10M' })
    })
})

describe('runway projection', () => {
    it('pro-rates a burn change that starts mid-month', async () => {
        const { projectRunway } = await import('#shared/forecast/project-runway.ts')
        const projection = projectRunway({
            today: '2026-11-01',
            startingCashCents: 100_000_000,
            monthlyBurnCents: 30_000_000,
            opportunities: [],
            adjustments: [{ kind: 'change_burn_pct', pct: 100, starts_at: '2026-11-16' }],
        })
        // Full burn for November plus double burn for 15 of 30 days.
        expect(projection.points[1]!.committed_cents).toBe(100_000_000 - 30_000_000 - 15_000_000)
    })
})
