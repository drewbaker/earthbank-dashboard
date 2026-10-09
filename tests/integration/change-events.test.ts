// Covers the change log: only real changes are logged, pending suggestions don't touch data, and
// accept / reject / revert do what they say.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

const { cleanupTestDatabase } = setupTestDatabase()
let funderId: string
let opportunityId: string
let userId: string

beforeAll(async () => {
    const { ensureDefaultGoals } = await import('#server/database/goals.ts')
    const { createFunderWithDetails, loadFunderDetail } = await import('#server/utils/funders.ts')
    await ensureDefaultGoals()
    userId = (await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })).id
    funderId = await createFunderWithDetails({
        name: 'IKEA Foundation',
        tier: 't2',
        opportunity: { goalType: 'lending_capital', stage: 'identified', amountCents: 2_500_000_000 },
    })
    opportunityId = (await loadFunderDetail({ funderId })).opportunities[0]!.id
})

afterAll(async () => {
    await cleanupTestDatabase()
})

describe('applyFieldChanges', () => {
    it('logs only fields whose value changes', async () => {
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const events = await applyFieldChanges({
            entityType: 'funder',
            entityId: funderId,
            changes: { tier: 't2', relationship_status: 'active', last_contact_at: '2026-06-24' },
            source: 'manual',
            actorUserId: userId,
        })
        expect(events.map(event => [event.field, event.from_value, event.to_value])).toEqual([
            ['relationship_status', 'no_contact', 'active'],
            ['last_contact_at', null, '2026-06-24'],
        ])
    })

    it('stores money as cents and dates as calendar dates', async () => {
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { amount_cents: 3_000_000_000, expected_receipt_at: '2027-03-01' },
            source: 'manual',
        })
        const opportunity = await findOpportunity({ opportunityId })
        expect(opportunity!.amount_cents).toBe(3_000_000_000n)
        expect(opportunity!.expected_receipt_at?.toISOString()).toBe('2027-03-01T00:00:00.000Z')
    })

    it('keeps a pending suggestion off the record until accepted', async () => {
        const { acceptChangeEvent, applyFieldChanges } = await import('#server/utils/change-events.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        const [pending] = await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { stage: 'proposal' },
            source: 'ai_email',
            status: 'pending',
            reason: 'Prateek asked for a proposal',
            confidence: 0.6,
        })
        expect((await findOpportunity({ opportunityId }))!.stage).toBe('identified')

        await acceptChangeEvent({ changeEventId: pending!.id, actorUserId: userId })
        expect((await findOpportunity({ opportunityId }))!.stage).toBe('proposal')
    })

    it('rejects a pending suggestion without changing anything', async () => {
        const { applyFieldChanges, rejectChangeEvent } = await import('#server/utils/change-events.ts')
        const { findChangeEvent } = await import('#server/database/change-events.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        const [pending] = await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { stage: 'lost' },
            source: 'ai_email',
            status: 'pending',
        })
        await rejectChangeEvent({ changeEventId: pending!.id, actorUserId: userId })
        expect((await findChangeEvent({ changeEventId: pending!.id }))!.status).toBe('rejected')
        expect((await findOpportunity({ opportunityId }))!.stage).toBe('proposal')
    })

    it('reverts an applied change and logs the revert as a manual edit', async () => {
        const { applyFieldChanges, revertChangeEvent } = await import('#server/utils/change-events.ts')
        const { findChangeEvent, listChangeEventRows } = await import('#server/database/change-events.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        const [applied] = await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { stage: 'due_diligence' },
            source: 'ai_email',
        })
        await revertChangeEvent({ changeEventId: applied!.id, actorUserId: userId })

        expect((await findOpportunity({ opportunityId }))!.stage).toBe('proposal')
        expect((await findChangeEvent({ changeEventId: applied!.id }))!.status).toBe('reverted')
        const [latest] = await listChangeEventRows({ entityIds: [opportunityId], limit: 1 })
        expect(latest).toMatchObject({ source: 'manual', field: 'stage', to_value: 'proposal', actor_user_id: userId })
    })

    it('refuses untracked fields', async () => {
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        await expect(
            applyFieldChanges({
                entityType: 'funder',
                entityId: funderId,
                changes: { name_key: 'x' } as never,
                source: 'manual',
            }),
        ).rejects.toThrow('not a tracked funder field')
    })
})

describe('out-of-date suggestions', () => {
    // Each test gets its own opportunity, so one test's edits don't make the next one's emails old.
    let opportunityId: string
    beforeEach(async () => {
        const { createFunderWithDetails, loadFunderDetail } = await import('#server/utils/funders.ts')
        const testFunderId = await createFunderWithDetails({
            name: `Test Funder ${Math.random()}`,
            opportunity: { goalType: 'design_grant', stage: 'identified', amountCents: null },
        })
        opportunityId = (await loadFunderDetail({ funderId: testFunderId })).opportunities[0]!.id
    })

    /**
     * Record an email as evidence.
     *
     * @param input.sentAt - When it was sent (YYYY-MM-DD).
     * @returns The evidence id.
     */
    async function evidenceFrom({ sentAt }: { sentAt: string }) {
        const { db } = await import('#server/utils/db.ts')
        const { newId } = await import('#server/utils/ids.ts')
        const evidence = await db().emailEvidence.create({
            data: {
                id: newId({ kind: 'emailEvidence' }),
                source: 'gmail',
                message_id_header: `<${Math.random()}@ikea.org>`,
                from_address: 'prateek@ikea.org',
                sent_at: new Date(`${sentAt}T12:00:00Z`),
                subject: 'Update',
                summary: 'An update.',
            },
        })
        return evidence.id
    }

    /**
     * Suggest a next step from an email sent on a given day.
     *
     * @param input.nextStep - The suggested next step.
     * @param input.sentAt - The email's date (YYYY-MM-DD).
     * @returns The pending event's id.
     */
    async function suggestNextStep({ nextStep, sentAt }: { nextStep: string; sentAt: string }) {
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const [event] = await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { next_step: nextStep },
            source: 'ai_email',
            status: 'pending',
            evidenceId: await evidenceFrom({ sentAt }),
            confidence: 0.6,
        })
        return event!.id
    }

    /**
     * A change event's status.
     *
     * @param input.changeEventId - The event.
     * @returns Its status.
     */
    async function statusOf({ changeEventId }: { changeEventId: string }) {
        const { findChangeEvent } = await import('#server/database/change-events.ts')
        return (await findChangeEvent({ changeEventId }))!.status
    }

    it('keeps only the suggestion from the newest email, whatever order they were read in', async () => {
        const july = await suggestNextStep({ nextStep: 'Send the deck', sentAt: '2026-07-28' })
        const september = await suggestNextStep({ nextStep: 'Book the board call', sentAt: '2026-09-02' })
        const august = await suggestNextStep({ nextStep: 'Send the budget', sentAt: '2026-08-10' })
        expect(await statusOf({ changeEventId: july })).toBe('superseded')
        expect(await statusOf({ changeEventId: august })).toBe('superseded')
        expect(await statusOf({ changeEventId: september })).toBe('pending')
    })

    it('retires a suggestion once someone edits the field by hand', async () => {
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const suggestion = await suggestNextStep({ nextStep: 'Call Prateek', sentAt: '2026-09-20' })
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            changes: { next_step: 'Wait for their committee' },
            source: 'manual',
            actorUserId: userId,
        })
        expect(await statusOf({ changeEventId: suggestion })).toBe('superseded')
    })

    it('refuses to accept a suggestion older than the field’s latest change', async () => {
        const { acceptChangeEvent } = await import('#server/utils/change-events.ts')
        const { writeFieldChanges } = await import('#server/database/change-events.ts')
        const { findOpportunity } = await import('#server/database/opportunities.ts')
        const suggestion = await suggestNextStep({ nextStep: 'Send the budget table', sentAt: '2026-09-25' })
        // A newer email's change landed without the usual check (e.g. written before this rule existed).
        await writeFieldChanges({
            entityType: 'opportunity',
            entityId: opportunityId,
            columnUpdates: { next_step: 'Sign the grant letter' },
            drafts: [{ field: 'next_step', fromValue: null, toValue: 'Sign the grant letter' }],
            source: 'ai_email',
            status: 'applied',
            actorUserId: null,
            evidenceId: await evidenceFrom({ sentAt: '2026-10-01' }),
            reason: null,
            confidence: 0.9,
        })
        await expect(acceptChangeEvent({ changeEventId: suggestion, actorUserId: userId })).rejects.toMatchObject({
            status: 409,
        })
        expect(await statusOf({ changeEventId: suggestion })).toBe('superseded')
        expect((await findOpportunity({ opportunityId }))!.next_step).toBe('Sign the grant letter')
    })

    it('retires suggestions that are already true in the sweep', async () => {
        const { supersedeAllStaleSuggestions } = await import('#server/utils/change-events.ts')
        const { db } = await import('#server/utils/db.ts')
        const suggestion = await suggestNextStep({ nextStep: 'Draft the MOU', sentAt: '2026-10-05' })
        await db().opportunity.update({ where: { id: opportunityId }, data: { next_step: 'Draft the MOU' } })
        expect(await supersedeAllStaleSuggestions()).toBeGreaterThanOrEqual(1)
        expect(await statusOf({ changeEventId: suggestion })).toBe('superseded')
    })
})
