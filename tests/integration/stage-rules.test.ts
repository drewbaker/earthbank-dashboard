// Covers the stage rules: approval sets the expected funding date 60 days later (unless a date is
// given), going to committee records the date and lifts the probability to at least 80%, accepting
// an AI suggestion applies the same rules, and spreadsheet imports don't.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'
import { opportunityProbability, defaultStageProbabilities } from '#shared/utils/probability.ts'

const { cleanupTestDatabase } = setupTestDatabase()
let userId: string

beforeAll(async () => {
    const { ensureDefaultGoals } = await import('#server/database/goals.ts')
    await ensureDefaultGoals()
    userId = (await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })).id
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * A funder with one opportunity at a stage, possibly with an expected date.
 *
 * @param input.name - Funder name.
 * @param input.stage - Starting stage.
 * @param input.expectedReceiptAt - Expected date, if any.
 * @returns The opportunity id.
 */
async function createOpportunity({
    name,
    stage,
    expectedReceiptAt = null,
}: {
    name: string
    stage: 'proposal' | 'due_diligence' | 'in_committee'
    expectedReceiptAt?: string | null
}) {
    const { createFunderWithDetails, loadFunderDetail } = await import('#server/utils/funders.ts')
    const funderId = await createFunderWithDetails({
        name,
        opportunity: { goalType: 'design_grant', stage, amountCents: 30_000_000, expectedReceiptAt },
    })
    return (await loadFunderDetail({ funderId })).opportunities[0]!
}

/**
 * The opportunity as the API shows it.
 *
 * @param input.opportunityId - The opportunity.
 * @returns Its stage and dates.
 */
async function readOpportunity({ opportunityId }: { opportunityId: string }) {
    const { findOpportunity } = await import('#server/database/opportunities.ts')
    const { serializeOpportunity } = await import('#server/utils/serializers/opportunities.ts')
    return serializeOpportunity({
        opportunity: (await findOpportunity({ opportunityId }))!,
        stageProbabilities: defaultStageProbabilities(),
    })
}

describe('approval', () => {
    it('expects the money 60 days after approval, replacing an earlier guess', async () => {
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const opportunity = await createOpportunity({
            name: 'Shell Foundation',
            stage: 'due_diligence',
            expectedReceiptAt: '2027-06-01',
        })
        const events = await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunity.id,
            changes: { stage: 'committed' },
            source: 'manual',
            actorUserId: userId,
            effectiveOn: '2026-10-09',
        })
        expect(events.map(event => [event.field, event.to_value])).toEqual([
            ['stage', 'committed'],
            ['expected_receipt_at', '2026-12-08'],
        ])
        expect(events[1]!.reason).toMatch(/60 days after approval/)
        expect(await readOpportunity({ opportunityId: opportunity.id })).toMatchObject({
            stage: 'committed',
            expected_receipt_at: '2026-12-08',
        })
    })

    it('keeps a date given with the approval (e.g. "payment in 3 weeks")', async () => {
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const opportunity = await createOpportunity({ name: 'UBS Optimus', stage: 'proposal' })
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunity.id,
            changes: { stage: 'committed', expected_receipt_at: '2026-10-28' },
            source: 'ai_email',
            effectiveOn: '2026-10-07',
        })
        expect((await readOpportunity({ opportunityId: opportunity.id })).expected_receipt_at).toBe('2026-10-28')
    })

    it('applies when an AI suggestion to approve is accepted, and not for spreadsheet imports', async () => {
        const { acceptChangeEvent, applyFieldChanges } = await import('#server/utils/change-events.ts')
        const suggested = await createOpportunity({ name: 'Hewlett', stage: 'proposal' })
        const [pending] = await applyFieldChanges({
            entityType: 'opportunity',
            entityId: suggested.id,
            changes: { stage: 'committed' },
            source: 'ai_email',
            status: 'pending',
        })
        expect((await readOpportunity({ opportunityId: suggested.id })).expected_receipt_at).toBeNull()
        await acceptChangeEvent({ changeEventId: pending!.id, actorUserId: userId })
        expect((await readOpportunity({ opportunityId: suggested.id })).expected_receipt_at).not.toBeNull()

        const imported = await createOpportunity({ name: 'Nordic Development Fund', stage: 'proposal' })
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: imported.id,
            changes: { stage: 'committed' },
            source: 'import',
        })
        expect((await readOpportunity({ opportunityId: imported.id })).expected_receipt_at).toBeNull()
    })
})

describe('committee', () => {
    it('records when it went to committee and counts it as at least 80% likely', async () => {
        const { applyFieldChanges } = await import('#server/utils/change-events.ts')
        const opportunity = await createOpportunity({ name: 'GA Foundation', stage: 'proposal' })
        await applyFieldChanges({
            entityType: 'opportunity',
            entityId: opportunity.id,
            changes: { stage: 'in_committee', probability_override: 50 },
            source: 'manual',
            actorUserId: userId,
            effectiveOn: '2026-10-08',
        })
        expect(await readOpportunity({ opportunityId: opportunity.id })).toMatchObject({
            stage: 'in_committee',
            committee_on: '2026-10-08',
            probability: 80,
        })
    })

    it('never lets the committee probability fall below 80%, but allows higher', () => {
        const stageProbabilities = { ...defaultStageProbabilities(), in_committee: 60 }
        expect(opportunityProbability({ stage: 'in_committee', probabilityOverride: null, stageProbabilities })).toBe(
            80,
        )
        expect(opportunityProbability({ stage: 'in_committee', probabilityOverride: 90, stageProbabilities })).toBe(90)
        expect(opportunityProbability({ stage: 'proposal', probabilityOverride: 10, stageProbabilities })).toBe(10)
    })

    it('rejects a team setting below 80% for In committee', async () => {
        const { StageProbabilities } = await import('#shared/schemas/index.ts')
        expect(StageProbabilities.safeParse({ ...defaultStageProbabilities(), in_committee: 70 }).success).toBe(false)
        expect(StageProbabilities.safeParse(defaultStageProbabilities()).success).toBe(true)
    })
})
