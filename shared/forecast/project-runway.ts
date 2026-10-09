import type { GoalType, MilestoneKind, OpportunityStage } from '#shared/constants/pipeline.ts'
import { OPPORTUNITY_STAGE_DETAILS } from '#shared/constants/pipeline.ts'
import type { ScenarioAdjustment } from '#shared/schemas/scenarios.ts'
import { addDays, addMonths, daysBetween, firstOfMonth, lastOfMonth } from '#shared/utils/calendar-dates.ts'

// The runway projection. Pure (no I/O, no clock) so the server's Overview and the browser's
// scenario builder compute exactly the same numbers.

export type ForecastOpportunity = {
    id: string
    name: string
    funder_id?: string
    funder_name: string
    goal_type: GoalType
    stage: OpportunityStage
    amount_cents: number | null
    expected_receipt_at: string | null
    /** 0–100: the stage default or the opportunity's override. */
    probability: number
}

export type ForecastMilestone = { id: string; title: string; due_at: string; kind: MilestoneKind }

export type ForecastPlannedExpense = {
    id: string
    label: string
    kind: 'one_off' | 'monthly'
    /** Positive: the one-off amount, or the amount per month. */
    amount_cents: number
    /** Payment date (one-off) or first month (monthly). */
    starts_on: string
    /** Last month of a monthly expense, or null for open-ended. */
    ends_on: string | null
}

/** Something that moves the lines, so the chart can say why. Amounts are signed (+ in, − out). */
export type ForecastEvent = {
    date: string
    label: string
    source: 'pipeline' | 'planned_expense' | 'scenario'
    /** Effect on the committed line (0 when only the weighted line moves). */
    committed_cents: number
    weighted_cents: number
    /** A monthly cost that starts here; the amounts are per month. */
    is_monthly: boolean
    /** Extra context, e.g. "35% likely" or "Expected date has passed". */
    note: string | null
    /** What the event comes from, so it can link to it. */
    opportunity_id: string | null
    funder_id: string | null
    planned_expense_id: string | null
}

export type ForecastPoint = {
    /** Last day of the month (the first point is today). */
    date: string
    committed_cents: number
    weighted_cents: number
    /** What happened in this month (or, for the first point, nothing: it's today's cash). */
    events: ForecastEvent[]
}

export type ForecastInflow = {
    opportunity_id: string
    funder_id: string | null
    label: string
    goal_type: GoalType
    /** When the money is modeled to land (overdue receipts are moved to today). */
    date: string
    is_overdue: boolean
    committed_cents: number
    weighted_cents: number
}

export type RunwayEnd = {
    /** Date cash is projected to go below zero, or null when it lasts past the horizon. */
    out_date: string | null
    /** Months from today until then (one decimal), or null. */
    months: number | null
}

export type RunwayProjection = {
    today: string
    horizon_end: string
    points: ForecastPoint[]
    runway: { committed: RunwayEnd; weighted: RunwayEnd }
    inflows: ForecastInflow[]
    /** Pipeline money that counts toward runway but has no expected date, so it isn't in the lines. */
    undated: { opportunity_id: string; label: string; committed_cents: number; weighted_cents: number }[]
    costs: { label: string; date: string; amount_cents: number }[]
    /** Every dated event in the horizon, in date order. */
    events: ForecastEvent[]
    markers: { id: string; title: string; date: string; kind: MilestoneKind }[]
}

/**
 * Project cash month by month: start from cash on hand, take off the monthly burn and planned
 * expenses, add pipeline money when it's expected to land. Two lines: committed money only, and the
 * probability-weighted pipeline. Planned expenses are decisions already made, so both lines include them.
 *
 * Only goals in `includeGoalTypes` count (by default Design Grants and OpEx: lending capital goes
 * into the lending structure, not the operating account). Received money is already in the bank.
 *
 * @param input.today - Today's date (YYYY-MM-DD).
 * @param input.startingCashCents - Cash on hand today.
 * @param input.monthlyBurnCents - Average monthly operating outflow.
 * @param input.opportunities - Pipeline opportunities.
 * @param input.milestones - Milestones shown as markers.
 * @param input.plannedExpenses - Spending the team has decided on (one-off or monthly).
 * @param input.adjustments - Scenario what-ifs to apply.
 * @param input.includeGoalTypes - Goals whose money funds operations.
 * @param input.months - Horizon in months (default 24).
 * @returns Monthly points, runway end dates, inflows, and markers.
 */
export function projectRunway({
    today,
    startingCashCents,
    monthlyBurnCents,
    opportunities,
    milestones = [],
    plannedExpenses = [],
    adjustments = [],
    includeGoalTypes = ['design_grant', 'opex'],
    months = 24,
}: {
    today: string
    startingCashCents: number
    monthlyBurnCents: number
    opportunities: ForecastOpportunity[]
    milestones?: ForecastMilestone[]
    plannedExpenses?: ForecastPlannedExpense[]
    adjustments?: ScenarioAdjustment[]
    includeGoalTypes?: GoalType[]
    months?: number
}): RunwayProjection {
    const horizonEnd = lastOfMonth({ value: addMonths({ value: firstOfMonth({ value: today }), months: months - 1 }) })
    const adjusted = applyOpportunityAdjustments({ opportunities, adjustments })
    const { inflows, undated } = buildInflows({ today, opportunities: adjusted, includeGoalTypes })
    // Planned expenses run through the same machinery as scenario costs, so they're pro-rated alike.
    const excludedExpenses = new Set(
        adjustments.flatMap(adjustment =>
            adjustment.kind === 'exclude_planned_expense' ? [adjustment.planned_expense_id] : [],
        ),
    )
    const plannedAdjustments = plannedExpenseAdjustments({
        plannedExpenses: plannedExpenses.filter(expense => !excludedExpenses.has(expense.id)),
    })
    const costAdjustments = [...plannedAdjustments, ...adjustments]
    const costs = buildOneOffs({ adjustments: costAdjustments })
    const events = buildEvents({ today, horizonEnd, inflows, adjustments: costAdjustments, plannedAdjustments })

    const points: ForecastPoint[] = [
        { date: today, committed_cents: startingCashCents, weighted_cents: startingCashCents, events: [] },
    ]
    const ends = { committed: emptyRunwayEnd(), weighted: emptyRunwayEnd() }
    let committedCash = startingCashCents
    let weightedCash = startingCashCents

    for (let monthIndex = 0; monthIndex < months; monthIndex++) {
        const monthStart = addMonths({ value: firstOfMonth({ value: today }), months: monthIndex })
        const monthEnd = lastOfMonth({ value: monthStart })
        const windowStart = monthIndex === 0 ? today : monthStart
        const outflow = monthOutflow({
            windowStart,
            monthStart,
            monthEnd,
            monthlyBurnCents,
            adjustments: costAdjustments,
        })
        const oneOffs = sumWithin({ items: costs, windowStart, monthEnd, amount: cost => cost.amount_cents })
        const committedIn = sumWithin({
            items: inflows,
            windowStart,
            monthEnd,
            amount: inflow => inflow.committed_cents,
        })
        const weightedIn = sumWithin({ items: inflows, windowStart, monthEnd, amount: inflow => inflow.weighted_cents })

        const nextCommitted = committedCash - outflow + oneOffs + committedIn
        const nextWeighted = weightedCash - outflow + oneOffs + weightedIn
        recordRunwayEnd({
            end: ends.committed,
            today,
            windowStart,
            monthEnd,
            cashBefore: committedCash,
            cashAfter: nextCommitted,
        })
        recordRunwayEnd({
            end: ends.weighted,
            today,
            windowStart,
            monthEnd,
            cashBefore: weightedCash,
            cashAfter: nextWeighted,
        })
        committedCash = nextCommitted
        weightedCash = nextWeighted
        points.push({
            date: monthEnd,
            committed_cents: Math.round(committedCash),
            weighted_cents: Math.round(weightedCash),
            events: events.filter(event => event.date >= windowStart && event.date <= monthEnd),
        })
    }

    return {
        today,
        horizon_end: horizonEnd,
        points,
        runway: ends,
        inflows,
        undated,
        costs,
        events,
        markers: milestones
            .filter(milestone => milestone.due_at >= today && milestone.due_at <= horizonEnd)
            .map(milestone => ({
                id: milestone.id,
                title: milestone.title,
                date: milestone.due_at,
                kind: milestone.kind,
            }))
            .sort((first, second) => first.date.localeCompare(second.date)),
    }
}

/**
 * Apply the opportunity what-ifs: exclusions, date shifts, amount and probability changes.
 *
 * @param input.opportunities - The pipeline as it stands.
 * @param input.adjustments - Scenario adjustments.
 * @returns A new list with the adjustments applied.
 */
function applyOpportunityAdjustments({
    opportunities,
    adjustments,
}: {
    opportunities: ForecastOpportunity[]
    adjustments: ScenarioAdjustment[]
}) {
    const excluded = new Set(
        adjustments.flatMap(adjustment =>
            adjustment.kind === 'exclude_opportunity' ? [adjustment.opportunity_id] : [],
        ),
    )
    return opportunities
        .filter(opportunity => !excluded.has(opportunity.id))
        .map(opportunity => {
            const result = { ...opportunity }
            for (const adjustment of adjustments) {
                if (!('opportunity_id' in adjustment) || adjustment.opportunity_id !== opportunity.id) {
                    continue
                }
                if (adjustment.kind === 'shift_receipt' && result.expected_receipt_at) {
                    result.expected_receipt_at = addMonths({
                        value: result.expected_receipt_at,
                        months: adjustment.months,
                    })
                } else if (adjustment.kind === 'change_amount') {
                    result.amount_cents = adjustment.amount_cents
                } else if (adjustment.kind === 'change_probability') {
                    result.probability = adjustment.probability
                }
            }
            return result
        })
}

/**
 * Turn opportunities into dated inflows (committed and weighted amounts), and collect the undated ones.
 *
 * @param input.today - Today's date; overdue receipts are modeled as landing today.
 * @param input.opportunities - Adjusted opportunities.
 * @param input.includeGoalTypes - Goals that fund operations.
 * @returns `{ inflows, undated }`.
 */
function buildInflows({
    today,
    opportunities,
    includeGoalTypes,
}: {
    today: string
    opportunities: ForecastOpportunity[]
    includeGoalTypes: GoalType[]
}) {
    const inflows: ForecastInflow[] = []
    const undated: RunwayProjection['undated'] = []
    for (const opportunity of opportunities) {
        const isCounted =
            includeGoalTypes.includes(opportunity.goal_type) &&
            (opportunity.stage === 'committed' || OPPORTUNITY_STAGE_DETAILS[opportunity.stage].isOpen) &&
            (opportunity.amount_cents ?? 0) > 0
        if (!isCounted) {
            continue
        }
        const amount = opportunity.amount_cents!
        const committedCents = opportunity.stage === 'committed' ? amount : 0
        const weightedCents =
            opportunity.stage === 'committed' ? amount : Math.round((amount * opportunity.probability) / 100)
        const label = `${opportunity.funder_name} · ${opportunity.name}`
        if (!opportunity.expected_receipt_at) {
            undated.push({
                opportunity_id: opportunity.id,
                label,
                committed_cents: committedCents,
                weighted_cents: weightedCents,
            })
            continue
        }
        const isOverdue = opportunity.expected_receipt_at < today
        inflows.push({
            opportunity_id: opportunity.id,
            funder_id: opportunity.funder_id ?? null,
            label,
            goal_type: opportunity.goal_type,
            date: isOverdue ? today : opportunity.expected_receipt_at,
            is_overdue: isOverdue,
            committed_cents: committedCents,
            weighted_cents: weightedCents,
        })
    }
    inflows.sort((first, second) => first.date.localeCompare(second.date))
    return { inflows, undated }
}

/**
 * Planned expenses as cost adjustments: one-offs as negative one-off amounts, monthly ones as
 * recurring costs from the first of their start month to the end of their last month. Each keeps a
 * `planned_expense_id` so events can tell them apart from scenario costs.
 *
 * @param input.plannedExpenses - Planned expenses.
 * @returns Adjustments, tagged with the planned expense id.
 */
function plannedExpenseAdjustments({ plannedExpenses }: { plannedExpenses: ForecastPlannedExpense[] }) {
    return plannedExpenses.map((expense): ScenarioAdjustment & { planned_expense_id: string } =>
        expense.kind === 'one_off'
            ? {
                  kind: 'add_one_off',
                  label: expense.label,
                  amount_cents: -Math.abs(expense.amount_cents),
                  at: expense.starts_on,
                  planned_expense_id: expense.id,
              }
            : {
                  kind: 'add_recurring_cost',
                  label: expense.label,
                  monthly_cents: Math.abs(expense.amount_cents),
                  starts_at: firstOfMonth({ value: expense.starts_on }),
                  ends_at: expense.ends_on ? lastOfMonth({ value: expense.ends_on }) : null,
                  planned_expense_id: expense.id,
              },
    )
}

/**
 * Everything that moves the lines, dated, for explaining the chart: pipeline money landing, one-off
 * costs and income, and the month a recurring cost or burn change starts.
 *
 * @param input.today - Today's date.
 * @param input.horizonEnd - Last day projected.
 * @param input.inflows - Dated pipeline inflows.
 * @param input.adjustments - Planned-expense and scenario cost adjustments.
 * @param input.plannedAdjustments - The planned-expense subset (to label the source).
 * @returns Events in date order.
 */
function buildEvents({
    today,
    horizonEnd,
    inflows,
    adjustments,
    plannedAdjustments,
}: {
    today: string
    horizonEnd: string
    inflows: ForecastInflow[]
    adjustments: ScenarioAdjustment[]
    plannedAdjustments: ScenarioAdjustment[]
}) {
    const planned = new Map(
        plannedAdjustments.map(adjustment => [
            adjustment as ScenarioAdjustment,
            (adjustment as { planned_expense_id?: string }).planned_expense_id ?? null,
        ]),
    )
    const links = (adjustment: ScenarioAdjustment) => ({
        opportunity_id: null,
        funder_id: null,
        planned_expense_id: planned.get(adjustment) ?? null,
    })
    const events: ForecastEvent[] = inflows.map(inflow => ({
        date: inflow.date,
        label: inflow.label,
        source: 'pipeline',
        committed_cents: inflow.committed_cents,
        weighted_cents: inflow.weighted_cents,
        is_monthly: false,
        note: inflow.is_overdue
            ? 'Expected date has passed; counted as landing now'
            : inflow.committed_cents === 0 && inflow.weighted_cents > 0
              ? 'Weighted by its chance of landing'
              : null,
        opportunity_id: inflow.opportunity_id,
        funder_id: inflow.funder_id,
        planned_expense_id: null,
    }))
    for (const adjustment of adjustments) {
        const source = planned.has(adjustment) ? 'planned_expense' : 'scenario'
        if (adjustment.kind === 'add_one_off') {
            events.push({
                date: adjustment.at < today ? today : adjustment.at,
                label: adjustment.label,
                source,
                committed_cents: adjustment.amount_cents,
                weighted_cents: adjustment.amount_cents,
                is_monthly: false,
                note: null,
                ...links(adjustment),
            })
        } else if (adjustment.kind === 'add_recurring_cost') {
            events.push({
                date: adjustment.starts_at < today ? today : adjustment.starts_at,
                label: adjustment.label,
                source,
                committed_cents: -adjustment.monthly_cents,
                weighted_cents: -adjustment.monthly_cents,
                is_monthly: true,
                note: adjustment.ends_at ? `Monthly until ${adjustment.ends_at.slice(0, 7)}` : 'Monthly, ongoing',
                ...links(adjustment),
            })
        } else if (adjustment.kind === 'change_burn_pct') {
            events.push({
                date: adjustment.starts_at < today ? today : adjustment.starts_at,
                label: `Burn ${adjustment.pct >= 0 ? 'up' : 'down'} ${Math.abs(adjustment.pct)}%`,
                source,
                committed_cents: 0,
                weighted_cents: 0,
                is_monthly: true,
                note: null,
                ...links(adjustment),
            })
        }
    }
    return events
        .filter(event => event.date <= horizonEnd)
        .sort((first, second) => first.date.localeCompare(second.date))
}

/**
 * One-off costs and income from the scenario.
 *
 * @param input.adjustments - Scenario adjustments.
 * @returns Dated amounts (+ in, − out).
 */
function buildOneOffs({ adjustments }: { adjustments: ScenarioAdjustment[] }) {
    return adjustments.flatMap(adjustment =>
        adjustment.kind === 'add_one_off'
            ? [{ label: adjustment.label, date: adjustment.at, amount_cents: adjustment.amount_cents }]
            : [],
    )
}

/**
 * Money out during part of a month: the burn (scaled by any burn changes) plus recurring costs,
 * pro-rated by days when the window or a cost covers only part of the month.
 *
 * @param input.windowStart - First day counted (today in the current month).
 * @param input.monthStart - First day of the month.
 * @param input.monthEnd - Last day of the month.
 * @param input.monthlyBurnCents - Baseline monthly burn.
 * @param input.adjustments - Scenario adjustments.
 * @returns Outflow in cents.
 */
function monthOutflow({
    windowStart,
    monthStart,
    monthEnd,
    monthlyBurnCents,
    adjustments,
}: {
    windowStart: string
    monthStart: string
    monthEnd: string
    monthlyBurnCents: number
    adjustments: ScenarioAdjustment[]
}) {
    const daysInMonth = daysBetween({ from: monthStart, to: monthEnd }) + 1
    const shareOfMonth = ({ from, to }: { from: string; to: string }) =>
        from > to ? 0 : (daysBetween({ from, to }) + 1) / daysInMonth

    // Burn changes are pro-rated from their start date, like recurring costs.
    let burn = monthlyBurnCents * shareOfMonth({ from: windowStart, to: monthEnd })
    let recurring = 0
    for (const adjustment of adjustments) {
        if (adjustment.kind === 'change_burn_pct' && adjustment.starts_at <= monthEnd) {
            const from = [windowStart, adjustment.starts_at].sort().at(-1)!
            burn += ((monthlyBurnCents * adjustment.pct) / 100) * shareOfMonth({ from, to: monthEnd })
        }
        if (adjustment.kind === 'add_recurring_cost') {
            const from = [windowStart, adjustment.starts_at].sort().at(-1)!
            const to = adjustment.ends_at && adjustment.ends_at < monthEnd ? adjustment.ends_at : monthEnd
            recurring += adjustment.monthly_cents * shareOfMonth({ from, to })
        }
    }
    return Math.max(0, burn) + recurring
}

/**
 * Sum the amounts of dated items that fall inside a window.
 *
 * @param input.items - Dated items.
 * @param input.windowStart - First day (inclusive).
 * @param input.monthEnd - Last day (inclusive).
 * @param input.amount - Picks each item's amount.
 * @returns The total.
 */
function sumWithin<Item extends { date: string }>({
    items,
    windowStart,
    monthEnd,
    amount,
}: {
    items: Item[]
    windowStart: string
    monthEnd: string
    amount: (item: Item) => number
}) {
    return items
        .filter(item => item.date >= windowStart && item.date <= monthEnd)
        .reduce((total, item) => total + amount(item), 0)
}

/**
 * Record the first month cash drops below zero, interpolating the day within the month.
 *
 * @param input.end - The runway end being tracked (mutated once).
 * @param input.today - Today's date.
 * @param input.windowStart - First day of this step.
 * @param input.monthEnd - Last day of this step.
 * @param input.cashBefore - Cash at the start of the step.
 * @param input.cashAfter - Cash at the end of the step.
 * @returns Nothing.
 */
function recordRunwayEnd({
    end,
    today,
    windowStart,
    monthEnd,
    cashBefore,
    cashAfter,
}: {
    end: RunwayEnd
    today: string
    windowStart: string
    monthEnd: string
    cashBefore: number
    cashAfter: number
}) {
    if (end.out_date || cashAfter >= 0) {
        return
    }
    const windowDays = daysBetween({ from: windowStart, to: monthEnd }) + 1
    const fraction = cashBefore <= 0 ? 0 : Math.min(1, cashBefore / (cashBefore - cashAfter))
    end.out_date = addDays({ value: windowStart, days: Math.floor(fraction * windowDays) })
    end.months = Math.round((daysBetween({ from: today, to: end.out_date }) / 30.44) * 10) / 10
}

/**
 * A runway end that hasn't been reached.
 *
 * @returns `{ out_date: null, months: null }`.
 */
function emptyRunwayEnd(): RunwayEnd {
    return { out_date: null, months: null }
}
