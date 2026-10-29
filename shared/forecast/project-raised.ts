import type { GoalType, OpportunityStage } from '#shared/constants/pipeline.ts'
import { OPPORTUNITY_STAGE_DETAILS } from '#shared/constants/pipeline.ts'
import { addMonths, firstOfMonth, lastOfMonth } from '#shared/utils/calendar-dates.ts'

// Money raised over time, and where it's heading. Pure (no I/O, no clock), like the runway projection.

export type RaisedOpportunity = {
    id: string
    name: string
    funder_name: string
    goal_type: GoalType
    stage: OpportunityStage
    amount_cents: number | null
    expected_receipt_at: string | null
    /** When the money arrived, for received asks (imported ones may not have it). */
    received_at: string | null
    /** 0–100: the stage default or the opportunity's override. */
    probability: number
}

/** One ask's money in a month: arrived, approved and expected, or expected at its weighted value. */
export type RaisedEvent = {
    opportunity_id: string
    label: string
    kind: 'received' | 'approved' | 'weighted'
    amount_cents: number
    /** Expected before today but not received yet: counted as landing today. */
    is_overdue: boolean
}

export type RaisedPoint = {
    /** The month's last day, or today. */
    date: string
    /** Money received by this date; null after today. */
    raised_cents: number | null
    /** Received plus approved and weighted open asks expected by this date; null before today. */
    projected_cents: number | null
    /** What moved the line since the previous point. */
    events: RaisedEvent[]
}

export type RaisedProjection = {
    today: string
    points: RaisedPoint[]
    /** Received so far. */
    raised_cents: number
    /** Where the projected line ends. */
    projected_cents: number
    /** Received before the chart starts, or with no received date: the line's starting level. */
    earlier_cents: number
    /** Open or approved asks with no expected date, so not on the projected line. */
    undated: { opportunity_id: string; label: string; weighted_cents: number }[]
}

/**
 * Money raised month by month up to today (received asks, by the day the money arrived), then the
 * projection: approved asks in full and open asks at their weighted value, by the day each is
 * expected. Asks overdue but not received count as landing today; declined asks never count.
 *
 * @param input.today - Today's date (YYYY-MM-DD).
 * @param input.opportunities - Pipeline opportunities.
 * @param input.goalTypes - Goals to count (e.g. design grants and OpEx).
 * @param input.historyMonths - Most months of history to show before today's month (default 12).
 * @param input.months - Months of projection, today's month included (default 24).
 * @returns Points, totals and the asks left off for having no date.
 */
export function projectRaised({
    today,
    opportunities,
    goalTypes,
    historyMonths = 12,
    months = 24,
}: {
    today: string
    opportunities: RaisedOpportunity[]
    goalTypes: GoalType[]
    historyMonths?: number
    months?: number
}): RaisedProjection {
    const counted = opportunities.filter(
        opportunity => goalTypes.includes(opportunity.goal_type) && (opportunity.amount_cents ?? 0) > 0,
    )
    const received = counted
        .filter(opportunity => opportunity.stage === 'received')
        .map(opportunity => ({
            opportunity,
            // Money recorded as arriving in the future is in the bank already: it counts today.
            date: opportunity.received_at && opportunity.received_at < today ? opportunity.received_at : null,
        }))
    const currentMonth = firstOfMonth({ value: today })
    const earliestReceipt = received.reduce<string | null>(
        (earliest, { date }) => (date && (!earliest || date < earliest) ? date : earliest),
        null,
    )
    const oldestShownMonth = addMonths({ value: currentMonth, months: -historyMonths })
    const firstMonth = earliestReceipt
        ? maxDate({ first: firstOfMonth({ value: earliestReceipt }), second: oldestShownMonth })
        : currentMonth

    let earlierCents = 0
    const receivedEvents: { date: string; event: RaisedEvent }[] = []
    for (const { opportunity, date } of received) {
        if (!date) {
            // Undated receipts (from the spreadsheet import) count from the start.
            earlierCents += opportunity.amount_cents!
            continue
        }
        if (date < firstMonth) {
            earlierCents += opportunity.amount_cents!
            continue
        }
        receivedEvents.push({
            date,
            event: {
                opportunity_id: opportunity.id,
                label: askLabel({ opportunity }),
                kind: 'received',
                amount_cents: opportunity.amount_cents!,
                is_overdue: false,
            },
        })
    }

    const points: RaisedPoint[] = []
    let raised = earlierCents
    let previousDate = ''
    // History: the end of each month before today's.
    for (let month = firstMonth; month < currentMonth; month = addMonths({ value: month, months: 1 })) {
        const date = lastOfMonth({ value: month })
        const events = eventsBetween({ items: receivedEvents, after: previousDate, through: date })
        raised += sumCents({ events })
        points.push({ date, raised_cents: raised, projected_cents: null, events })
        previousDate = date
    }
    const todayEvents = eventsBetween({ items: receivedEvents, after: previousDate, through: today })
    raised += sumCents({ events: todayEvents })
    // Today joins the two lines: the projection starts where raised money stands.
    points.push({ date: today, raised_cents: raised, projected_cents: raised, events: todayEvents })

    const { expected, undated } = expectedMoney({ today, opportunities: counted })
    let projected = raised
    // Expected dates are never before today (overdue asks are dated today), so the first projected
    // month takes everything up to its end.
    previousDate = ''
    for (let index = 0; index < months; index++) {
        const date = lastOfMonth({ value: addMonths({ value: currentMonth, months: index }) })
        if (date <= today) {
            continue
        }
        const events = eventsBetween({ items: expected, after: previousDate, through: date })
        projected += sumCents({ events })
        points.push({ date, raised_cents: null, projected_cents: projected, events })
        previousDate = date
    }
    return { today, points, raised_cents: raised, projected_cents: projected, earlier_cents: earlierCents, undated }
}

/**
 * Approved and open asks as dated, weighted amounts; overdue ones dated today; undated ones apart.
 *
 * @param input.today - Today's date.
 * @param input.opportunities - Asks in the counted goals.
 * @returns `{ expected, undated }`.
 */
function expectedMoney({ today, opportunities }: { today: string; opportunities: RaisedOpportunity[] }) {
    const expected: { date: string; event: RaisedEvent }[] = []
    const undated: RaisedProjection['undated'] = []
    for (const opportunity of opportunities) {
        const isApproved = opportunity.stage === 'committed'
        if (!isApproved && !OPPORTUNITY_STAGE_DETAILS[opportunity.stage].isOpen) {
            continue
        }
        const amount = opportunity.amount_cents!
        const weightedCents = isApproved ? amount : Math.round((amount * opportunity.probability) / 100)
        if (weightedCents <= 0) {
            continue
        }
        const label = askLabel({ opportunity })
        if (!opportunity.expected_receipt_at) {
            undated.push({ opportunity_id: opportunity.id, label, weighted_cents: weightedCents })
            continue
        }
        const isOverdue = opportunity.expected_receipt_at <= today
        expected.push({
            date: isOverdue ? today : opportunity.expected_receipt_at,
            event: {
                opportunity_id: opportunity.id,
                label,
                kind: isApproved ? 'approved' : 'weighted',
                amount_cents: weightedCents,
                is_overdue: opportunity.expected_receipt_at < today,
            },
        })
    }
    expected.sort((first, second) => first.date.localeCompare(second.date))
    return { expected, undated }
}

/**
 * The events dated after one day and up to another.
 *
 * @param input.items - Dated events.
 * @param input.after - Exclusive start (YYYY-MM-DD, or '' for the beginning).
 * @param input.through - Inclusive end.
 * @returns The events, oldest first.
 */
function eventsBetween({
    items,
    after,
    through,
}: {
    items: { date: string; event: RaisedEvent }[]
    after: string
    through: string
}) {
    return items
        .filter(item => item.date > after && item.date <= through)
        .sort((first, second) => first.date.localeCompare(second.date))
        .map(item => item.event)
}

/**
 * Total of some events.
 *
 * @param input.events - The events.
 * @returns Their cents.
 */
function sumCents({ events }: { events: RaisedEvent[] }) {
    return events.reduce((sum, event) => sum + event.amount_cents, 0)
}

/**
 * How an ask is named in the tooltip: "UBS Optimus · Design grant".
 *
 * @param input.opportunity - The ask.
 * @returns The label.
 */
function askLabel({ opportunity }: { opportunity: RaisedOpportunity }) {
    return `${opportunity.funder_name} · ${opportunity.name}`
}

/**
 * The later of two dates.
 *
 * @param input.first - YYYY-MM-DD.
 * @param input.second - YYYY-MM-DD.
 * @returns The later one.
 */
function maxDate({ first, second }: { first: string; second: string }) {
    return first > second ? first : second
}
