import { readSettingValue, writeSettingValue } from '#server/database/settings.ts'
import type { CashSettings } from '#shared/schemas/cash.ts'
import { CashSettings as CashSettingsSchema } from '#shared/schemas/cash.ts'

const CASH_SETTINGS_KEY = 'cash_settings'
const SYNC_STATE_KEY = 'bookkeeping_sync'

const DEFAULT_CASH_SETTINGS: CashSettings = {
    manual_balance_cents: null,
    manual_balance_as_of: null,
    burn_override_cents: null,
    lookback_months: 3,
    excluded_categories: [],
    include_goal_types: ['design_grant', 'opex'],
}

export type BookkeepingSyncState = { last_synced_at: string | null; last_error: string | null }

/**
 * Cash settings with defaults for anything unset.
 *
 * @returns The settings.
 */
export async function readCashSettings(): Promise<CashSettings> {
    const stored = await readSettingValue({ key: CASH_SETTINGS_KEY })
    const parsed = CashSettingsSchema.safeParse({ ...DEFAULT_CASH_SETTINGS, ...(isObject(stored) ? stored : {}) })
    return parsed.success ? parsed.data : DEFAULT_CASH_SETTINGS
}

/**
 * Merge changes into the cash settings.
 *
 * @param input.changes - Fields to change (already validated).
 * @returns The saved settings.
 */
export async function updateCashSettings({ changes }: { changes: Partial<CashSettings> }) {
    const next = CashSettingsSchema.parse({ ...(await readCashSettings()), ...changes })
    await writeSettingValue({ key: CASH_SETTINGS_KEY, value: next })
    return next
}

/**
 * When Bookeeping.ai last synced, and the last error if the latest attempt failed.
 *
 * @returns The sync state.
 */
export async function readSyncState(): Promise<BookkeepingSyncState> {
    const stored = await readSettingValue({ key: SYNC_STATE_KEY })
    return isObject(stored)
        ? {
              last_synced_at: typeof stored.last_synced_at === 'string' ? stored.last_synced_at : null,
              last_error: typeof stored.last_error === 'string' ? stored.last_error : null,
          }
        : { last_synced_at: null, last_error: null }
}

/**
 * Save the sync state.
 *
 * @param input.state - New state.
 * @returns Resolves once saved.
 */
export async function writeSyncState({ state }: { state: BookkeepingSyncState }) {
    await writeSettingValue({ key: SYNC_STATE_KEY, value: state })
}

/**
 * Narrow JSON to a plain object.
 *
 * @param value - Stored JSON.
 * @returns True for non-null, non-array objects.
 */
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
