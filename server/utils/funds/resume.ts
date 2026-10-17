import { isPriorityOrigin, listFundsNeedingResearch } from '#server/database/fund-managers.ts'
import { config } from '#server/utils/config.ts'
import { readFundResearchSettings, readMonthResearchSpend } from '#server/utils/funds/research-settings.ts'
import { enqueueFundResearch } from '#server/utils/jobs/enqueue.ts'

// A fund waiting or "running" this long lost its job (a deploy restarted the service).
const STALE_AFTER_MS = 60 * 60 * 1000
const MAX_PER_RUN = 200

/**
 * Queue research again for funds whose job was lost or that were paused by the budget.
 *
 * Runs hourly and at startup. Does nothing without an API key or when this month's budget is spent;
 * jobs are unique per fund, so a fund already waiting isn't queued twice.
 *
 * @param input.now - Current time.
 * @returns How many funds were queued.
 */
export async function resumeFundResearch({ now }: { now: Date }) {
    if (!config.anthropicApiKey) {
        return 0
    }
    const settings = await readFundResearchSettings()
    if ((await readMonthResearchSpend({ settings, now })).isOverBudget) {
        return 0
    }
    const funds = await listFundsNeedingResearch({
        staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
        limit: MAX_PER_RUN,
    })
    let queued = 0
    for (const fund of funds) {
        const result = await enqueueFundResearch({
            fundManagerId: fund.id,
            isPriority: isPriorityOrigin({ origin: fund.origin }),
        })
        queued += result === 'queued' ? 1 : 0
    }
    return queued
}
