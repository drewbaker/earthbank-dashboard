import { readSettingValue, writeSettingValue } from '#server/database/settings.ts'
import { sumResearchCostSince } from '#server/database/fund-research.ts'
import type { FundResearchSettings } from '#shared/schemas/funds.ts'
import { FundResearchSettings as FundResearchSettingsSchema } from '#shared/schemas/funds.ts'

const FUND_RESEARCH_SETTINGS_KEY = 'fund_research'

// Start with 100 funds (raise toward 1,000 in Settings → Research once the research looks right).
export const DEFAULT_FUND_RESEARCH_SETTINGS: FundResearchSettings = {
    spider_enabled: true,
    max_funds: 100,
    monthly_budget_usd: 300,
    max_searches_per_fund: 20,
    max_fetches_per_fund: 25,
    min_confidence: 0.7,
}

/**
 * The team's research settings, falling back to defaults for anything unset or invalid.
 *
 * @returns The settings.
 */
export async function readFundResearchSettings(): Promise<FundResearchSettings> {
    const stored = await readSettingValue({ key: FUND_RESEARCH_SETTINGS_KEY })
    const merged = {
        ...DEFAULT_FUND_RESEARCH_SETTINGS,
        ...(typeof stored === 'object' && stored !== null ? stored : {}),
    }
    const parsed = FundResearchSettingsSchema.safeParse(merged)
    return parsed.success ? parsed.data : DEFAULT_FUND_RESEARCH_SETTINGS
}

/**
 * Save research settings.
 *
 * @param input.settings - The full settings (validated by the caller).
 * @returns The saved settings.
 */
export async function writeFundResearchSettings({ settings }: { settings: FundResearchSettings }) {
    await writeSettingValue({ key: FUND_RESEARCH_SETTINGS_KEY, value: settings })
    return settings
}

/**
 * The first moment of the current month, UTC (budgets reset monthly).
 *
 * @param input.now - Current time.
 * @returns The month's start.
 */
export function monthStart({ now }: { now: Date }) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * What research has cost this month and whether the budget is spent.
 *
 * @param input.settings - Research settings (for the budget).
 * @param input.now - Current time.
 * @returns Spend in US dollars and whether it reached the budget.
 */
export async function readMonthResearchSpend({ settings, now }: { settings: FundResearchSettings; now: Date }) {
    const spendUsd = (await sumResearchCostSince({ since: monthStart({ now }) })) / 1_000_000
    return { spendUsd, isOverBudget: spendUsd >= settings.monthly_budget_usd }
}
