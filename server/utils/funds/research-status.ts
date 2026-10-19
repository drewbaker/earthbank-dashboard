import {
    countActiveFundManagers,
    countArchivedFundManagers,
    countFundsByResearchStatus,
    countPendingFundManagers,
} from '#server/database/fund-managers.ts'
import { config } from '#server/utils/config.ts'
import { readFundResearchSettings, readMonthResearchSpend } from '#server/utils/funds/research-settings.ts'
import type { FundResearchStatus } from '#shared/schemas/index.ts'

/**
 * The research assistant's state for the Funds page header: list size against its limit, the queue,
 * and this month's spend against the budget.
 *
 * @param input.now - Current time.
 * @returns The status summary.
 */
export async function readFundResearchStatus({ now }: { now: Date }): Promise<FundResearchStatus> {
    const settings = await readFundResearchSettings()
    const [funds, counts, pendingApproval, archived, spend] = await Promise.all([
        countActiveFundManagers(),
        countFundsByResearchStatus(),
        countPendingFundManagers(),
        countArchivedFundManagers(),
        readMonthResearchSpend({ settings, now }),
    ])
    return {
        funds,
        max_funds: settings.max_funds,
        queued: counts.queued ?? 0,
        running: counts.running ?? 0,
        done: counts.done ?? 0,
        failed: counts.failed ?? 0,
        skipped: counts.skipped ?? 0,
        pending_approval: pendingApproval,
        archived,
        month_spend_usd: Math.round(spend.spendUsd * 100) / 100,
        monthly_budget_usd: settings.monthly_budget_usd,
        spider_enabled: settings.spider_enabled,
        is_ai_configured: Boolean(config.anthropicApiKey),
    }
}
