// Covers the change log: only real changes are logged, pending suggestions don't touch data, and
// accept / reject / revert do what they say.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
