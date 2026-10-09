// Covers the runway math: burn, committed vs weighted inflows, the runway-out date, every scenario
// adjustment, planned expenses, and the events that explain each month.
import { describe, expect, it } from 'vitest'
import type { ForecastOpportunity } from '#shared/forecast/project-runway.ts'
import { projectRunway } from '#shared/forecast/project-runway.ts'

const TODAY = '2026-11-01'
const MILLION = 100_000_000

/**
 * A test opportunity.
 *
 * @param overrides - Fields to change.
 * @returns The opportunity.
 */
function opportunity(overrides: Partial<ForecastOpportunity>): ForecastOpportunity {
    return {
        id: 'opp_1',
        name: 'Design grant',
        funder_name: 'UBS Optimus',
        goal_type: 'design_grant',
        stage: 'committed',
        amount_cents: MILLION,
        expected_receipt_at: '2027-01-15',
        probability: 95,
        ...overrides,
    }
}

describe('projectRunway', () => {
    it('burns cash month by month and finds the day it runs out', () => {
        // $1M on Nov 1 at $250k/month: Nov, Dec, Jan, Feb → zero at the end of February.
        const projection = projectRunway({
            today: TODAY,
            startingCashCents: MILLION,
            monthlyBurnCents: MILLION / 4,
            opportunities: [],
        })
        expect(projection.points[0]).toEqual({
            date: TODAY,
            committed_cents: MILLION,
            weighted_cents: MILLION,
            events: [],
        })
        expect(projection.points[1]).toMatchObject({ date: '2026-11-30', committed_cents: 75_000_000 })
        expect(projection.points[4]!.committed_cents).toBe(0)
        expect(projection.runway.committed.out_date).toBe('2027-03-01')
        expect(projection.runway.committed.months).toBe(3.9)
        expect(projection.horizon_end).toBe('2028-10-31')
    })

    it('pro-rates the burn for the rest of the current month', () => {
        const projection = projectRunway({
            today: '2026-11-16',
            startingCashCents: MILLION,
            monthlyBurnCents: 30_000_000,
            opportunities: [],
        })
        // 15 of 30 days left in November.
        expect(projection.points[1]!.committed_cents).toBe(85_000_000)
    })

    it('adds committed money to both lines and open asks only to the weighted line', () => {
        const projection = projectRunway({
            today: TODAY,
            startingCashCents: MILLION,
            monthlyBurnCents: 0,
            opportunities: [
                opportunity({ id: 'committed', stage: 'committed' }),
                opportunity({ id: 'open', stage: 'due_diligence', probability: 60, amount_cents: 50_000_000 }),
            ],
        })
        const january = projection.points.find(point => point.date === '2027-01-31')!
        expect(january.committed_cents).toBe(2 * MILLION)
        expect(january.weighted_cents).toBe(2 * MILLION + 30_000_000)
    })

    it('leaves out lending capital, received and lost money, and lists undated asks separately', () => {
        const projection = projectRunway({
            today: TODAY,
            startingCashCents: 0,
            monthlyBurnCents: 0,
            opportunities: [
                opportunity({ id: 'lending', goal_type: 'lending_capital' }),
                opportunity({ id: 'received', stage: 'received' }),
                opportunity({ id: 'lost', stage: 'lost' }),
                opportunity({ id: 'undated', expected_receipt_at: null }),
            ],
        })
        expect(projection.inflows).toEqual([])
        expect(projection.undated.map(item => item.opportunity_id)).toEqual(['undated'])
        expect(projection.points.at(-1)!.weighted_cents).toBe(0)
    })

    it('treats overdue receipts as landing today', () => {
        const projection = projectRunway({
            today: TODAY,
            startingCashCents: 0,
            monthlyBurnCents: 0,
            opportunities: [opportunity({ expected_receipt_at: '2026-09-30' })],
        })
        expect(projection.inflows[0]).toMatchObject({ date: TODAY, is_overdue: true })
        expect(projection.points[1]!.committed_cents).toBe(MILLION)
    })

    it('is never out of runway when money arrives in time', () => {
        const projection = projectRunway({
            today: TODAY,
            startingCashCents: MILLION,
            monthlyBurnCents: MILLION / 4,
            opportunities: [opportunity({ amount_cents: 10 * MILLION, expected_receipt_at: '2027-02-01' })],
        })
        expect(projection.runway.committed).toEqual({ out_date: null, months: null })
    })
})

describe('scenario adjustments', () => {
    const base = {
        today: TODAY,
        startingCashCents: MILLION,
        monthlyBurnCents: MILLION / 4,
        opportunities: [opportunity({ amount_cents: MILLION, expected_receipt_at: '2027-02-15' })],
    }

    it('shift_receipt moves the money and can pull the runway end earlier', () => {
        const onTime = projectRunway(base)
        const slipped = projectRunway({
            ...base,
            adjustments: [{ kind: 'shift_receipt', opportunity_id: 'opp_1', months: 3 }],
        })
        expect(slipped.inflows[0]!.date).toBe('2027-05-15')
        expect(slipped.runway.committed.out_date).toBe('2027-03-01')
        expect(onTime.runway.committed.out_date! > slipped.runway.committed.out_date!).toBe(true)
    })

    it('change_amount, change_probability and exclude_opportunity change the inflow', () => {
        const opportunities = [opportunity({ stage: 'proposal', probability: 35 })]
        const changed = projectRunway({
            ...base,
            opportunities,
            adjustments: [
                { kind: 'change_amount', opportunity_id: 'opp_1', amount_cents: 2 * MILLION },
                { kind: 'change_probability', opportunity_id: 'opp_1', probability: 50 },
            ],
        })
        expect(changed.inflows[0]!.weighted_cents).toBe(MILLION)
        const excluded = projectRunway({
            ...base,
            opportunities,
            adjustments: [{ kind: 'exclude_opportunity', opportunity_id: 'opp_1' }],
        })
        expect(excluded.inflows).toEqual([])
    })

    it('add_recurring_cost (a hire) adds a pro-rated monthly cost from its start date', () => {
        const projection = projectRunway({
            ...base,
            opportunities: [],
            monthlyBurnCents: 0,
            adjustments: [
                {
                    kind: 'add_recurring_cost',
                    label: 'Head of Partnerships',
                    monthly_cents: 3_000_000,
                    starts_at: '2026-12-16',
                    ends_at: null,
                },
            ],
        })
        expect(projection.points[1]!.committed_cents).toBe(MILLION)
        // Dec 16–31 is 16 of 31 days.
        expect(projection.points[2]!.committed_cents).toBe(MILLION - Math.round((3_000_000 * 16) / 31))
        expect(projection.points[3]!.committed_cents).toBe(MILLION - Math.round((3_000_000 * 16) / 31) - 3_000_000)
    })

    it('add_one_off adds or removes money in its month', () => {
        const projection = projectRunway({
            ...base,
            opportunities: [],
            monthlyBurnCents: 0,
            adjustments: [
                { kind: 'add_one_off', label: 'Audit', amount_cents: -2_000_000, at: '2026-12-10' },
                { kind: 'add_one_off', label: 'Board gift', amount_cents: 5_000_000, at: '2027-01-05' },
            ],
        })
        expect(projection.points[2]!.committed_cents).toBe(MILLION - 2_000_000)
        expect(projection.points[3]!.committed_cents).toBe(MILLION + 3_000_000)
    })

    it('change_burn_pct scales the burn from its start month', () => {
        const projection = projectRunway({
            ...base,
            opportunities: [],
            monthlyBurnCents: 10_000_000,
            adjustments: [{ kind: 'change_burn_pct', pct: 20, starts_at: '2026-12-01' }],
        })
        expect(projection.points[1]!.committed_cents).toBe(MILLION - 10_000_000)
        expect(projection.points[2]!.committed_cents).toBe(MILLION - 10_000_000 - 12_000_000)
    })

    it('includes milestones in range as markers', () => {
        const projection = projectRunway({
            ...base,
            milestones: [
                { id: 'm1', title: 'UBS decision', due_at: '2026-12-01', kind: 'funding' },
                { id: 'm0', title: 'Past', due_at: '2026-10-01', kind: 'event' },
            ],
        })
        expect(projection.markers.map(marker => marker.id)).toEqual(['m1'])
    })
})

describe('planned expenses and events', () => {
    it('takes one-off and monthly planned expenses off both lines', () => {
        const projection = projectRunway({
            today: TODAY,
            startingCashCents: MILLION,
            monthlyBurnCents: 0,
            opportunities: [],
            plannedExpenses: [
                {
                    id: 'pex_study',
                    label: 'Market research study',
                    kind: 'one_off',
                    amount_cents: 20_000_000,
                    starts_on: '2026-12-10',
                    ends_on: null,
                },
                {
                    id: 'pex_hire',
                    label: 'Analyst',
                    kind: 'monthly',
                    amount_cents: 1_000_000,
                    starts_on: '2027-01-15',
                    ends_on: '2027-02-01',
                },
            ],
        })
        // Nov: nothing. Dec: −$200K. Jan and Feb: −$10K each (whole months). Mar: nothing.
        expect(projection.points.slice(1, 6).map(point => point.committed_cents)).toEqual([
            MILLION,
            80_000_000,
            79_000_000,
            78_000_000,
            78_000_000,
        ])
        expect(projection.points[2]!.weighted_cents).toBe(80_000_000)
        expect(projection.points[2]!.events).toEqual([
            expect.objectContaining({
                label: 'Market research study',
                source: 'planned_expense',
                committed_cents: -20_000_000,
                is_monthly: false,
            }),
        ])
        expect(projection.points[3]!.events[0]).toMatchObject({
            label: 'Analyst',
            date: '2027-01-01',
            committed_cents: -1_000_000,
            is_monthly: true,
        })
    })

    it('explains pipeline money landing, weighted when not committed', () => {
        const projection = projectRunway({
            today: TODAY,
            startingCashCents: MILLION,
            monthlyBurnCents: 0,
            opportunities: [opportunity({ funder_name: 'Shell Foundation', stage: 'proposal', probability: 30 })],
        })
        const january = projection.points.find(point => point.date === '2027-01-31')!
        expect(january.events).toEqual([
            expect.objectContaining({
                label: 'Shell Foundation · Design grant',
                source: 'pipeline',
                committed_cents: 0,
                weighted_cents: 30_000_000,
                note: 'Weighted by its chance of landing',
            }),
        ])
        expect(projection.events).toHaveLength(1)
    })

    it('lets a scenario leave a planned expense out', () => {
        const plannedExpenses = [
            {
                id: 'pex_study',
                label: 'Market research study',
                kind: 'one_off' as const,
                amount_cents: 20_000_000,
                starts_on: '2026-12-10',
                ends_on: null,
            },
        ]
        const projection = projectRunway({
            today: TODAY,
            startingCashCents: MILLION,
            monthlyBurnCents: 0,
            opportunities: [],
            plannedExpenses,
            adjustments: [{ kind: 'exclude_planned_expense', planned_expense_id: 'pex_study' }],
        })
        expect(projection.points.at(-1)!.committed_cents).toBe(MILLION)
        expect(projection.events).toEqual([])
    })
})
