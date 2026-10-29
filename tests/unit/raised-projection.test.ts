// Covers the Raised chart's math: received money by the month it arrived (undated and older receipts
// as the starting level), then approved asks in full and open asks weighted by their expected dates,
// overdue asks landing in the first projected month, and asks without a date left off the line.
import { describe, expect, it } from 'vitest'
import type { RaisedOpportunity } from '#shared/forecast/project-raised.ts'
import { projectRaised } from '#shared/forecast/project-raised.ts'

const TODAY = '2026-10-29'
const MILLION = 100_000_000

/**
 * A test opportunity.
 *
 * @param overrides - Fields to change.
 * @returns The opportunity.
 */
function opportunity(overrides: Partial<RaisedOpportunity>): RaisedOpportunity {
    return {
        id: 'opp_1',
        name: 'Design grant',
        funder_name: 'UBS Optimus',
        goal_type: 'design_grant',
        stage: 'received',
        amount_cents: MILLION,
        expected_receipt_at: null,
        received_at: '2026-08-10',
        probability: 100,
        ...overrides,
    }
}

describe('projectRaised', () => {
    it('climbs month by month as money arrives, then continues with the projection from today', () => {
        const projection = projectRaised({
            today: TODAY,
            goalTypes: ['design_grant', 'opex'],
            months: 3,
            opportunities: [
                opportunity({ id: 'opp_aug', received_at: '2026-08-10' }),
                opportunity({ id: 'opp_oct', received_at: '2026-10-02', amount_cents: MILLION / 2 }),
                opportunity({ id: 'opp_old', received_at: null, amount_cents: MILLION / 4 }),
                opportunity({
                    id: 'opp_approved',
                    stage: 'committed',
                    received_at: null,
                    expected_receipt_at: '2026-11-20',
                }),
                opportunity({
                    id: 'opp_open',
                    stage: 'proposal',
                    received_at: null,
                    expected_receipt_at: '2026-12-05',
                    probability: 40,
                }),
                opportunity({ id: 'opp_lost', stage: 'lost', received_at: null, expected_receipt_at: '2026-11-01' }),
                opportunity({ id: 'opp_lending', goal_type: 'lending_capital', received_at: '2026-09-01' }),
            ],
        })
        expect(projection.earlier_cents).toBe(MILLION / 4)
        expect(projection.points.map(point => [point.date, point.raised_cents, point.projected_cents])).toEqual([
            ['2026-08-31', 125_000_000, null],
            ['2026-09-30', 125_000_000, null],
            ['2026-10-29', 175_000_000, 175_000_000],
            ['2026-10-31', null, 175_000_000],
            ['2026-11-30', null, 275_000_000],
            ['2026-12-31', null, 315_000_000],
        ])
        expect(projection.points[4]!.events).toEqual([
            expect.objectContaining({ opportunity_id: 'opp_approved', kind: 'approved', amount_cents: MILLION }),
        ])
        expect(projection.points[5]!.events[0]).toMatchObject({ kind: 'weighted', amount_cents: 40_000_000 })
        expect(projection).toMatchObject({ raised_cents: 175_000_000, projected_cents: 315_000_000 })
    })

    it('lands overdue asks in the first projected month and leaves undated ones off the line', () => {
        const projection = projectRaised({
            today: TODAY,
            goalTypes: ['design_grant'],
            months: 2,
            opportunities: [
                opportunity({
                    id: 'opp_late',
                    stage: 'committed',
                    received_at: null,
                    expected_receipt_at: '2026-09-01',
                }),
                opportunity({
                    id: 'opp_undated',
                    stage: 'in_discussion',
                    received_at: null,
                    expected_receipt_at: null,
                    probability: 20,
                }),
            ],
        })
        // Nothing received yet: the chart starts today.
        expect(projection.points[0]).toMatchObject({ date: TODAY, raised_cents: 0, projected_cents: 0 })
        expect(projection.points[1]).toMatchObject({ date: '2026-10-31', projected_cents: MILLION })
        expect(projection.points[1]!.events[0]).toMatchObject({ opportunity_id: 'opp_late', is_overdue: true })
        expect(projection.undated).toEqual([
            { opportunity_id: 'opp_undated', label: 'UBS Optimus · Design grant', weighted_cents: 20_000_000 },
        ])
    })

    it('shows at most a year of history, counting older receipts in the starting level', () => {
        const projection = projectRaised({
            today: TODAY,
            goalTypes: ['design_grant'],
            months: 1,
            opportunities: [
                opportunity({ received_at: '2024-03-01' }),
                opportunity({ id: 'opp_2', received_at: '2026-01-15' }),
            ],
        })
        expect(projection.points[0]!.date).toBe('2025-10-31')
        expect(projection.points[0]!.raised_cents).toBe(MILLION)
        expect(projection.earlier_cents).toBe(MILLION)
        expect(projection.raised_cents).toBe(2 * MILLION)
    })
})
