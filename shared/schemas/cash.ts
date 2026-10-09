import { z } from 'zod'
import { GOAL_TYPES } from '#shared/constants/pipeline.ts'
import { Cents, DateOnly, DateOnlyInput, IsoDateTime } from '#shared/schemas/common.ts'

export const CashSettings = z.object({
    /** Used when Bookeeping.ai isn't connected yet. */
    manual_balance_cents: Cents.nullable(),
    manual_balance_as_of: DateOnly.nullable(),
    /** Replaces the computed burn when set. */
    burn_override_cents: Cents.nullable(),
    lookback_months: z.number().int().min(1).max(12),
    /** Bookkeeping categories left out of the burn (e.g. "Loan repayment"). */
    excluded_categories: z.array(z.string().max(200)).max(100),
    /** Goals whose money funds operations and so extends runway. */
    include_goal_types: z.array(z.enum(GOAL_TYPES)).min(1),
})
export type CashSettings = z.infer<typeof CashSettings>

export const UpdateCashSettingsRequest = CashSettings.extend({
    manual_balance_as_of: DateOnlyInput.nullable(),
}).partial()
export type UpdateCashSettingsRequest = z.infer<typeof UpdateCashSettingsRequest>

export const BankAccount = z.object({
    id: z.string(),
    name: z.string(),
    account_type: z.string(),
    is_included: z.boolean(),
    balance_cents: z.number().int().nullable(),
    balance_as_of: DateOnly.nullable(),
    last_synced_at: IsoDateTime.nullable(),
})
export type BankAccount = z.infer<typeof BankAccount>

export const CashSummary = z.object({
    balance_cents: z.number().int().nullable(),
    balance_as_of: DateOnly.nullable(),
    balance_source: z.enum(['bookeeping', 'manual', 'none']),
    monthly_burn_cents: Cents.nullable(),
    burn_source: z.enum(['computed', 'override', 'none']),
    /** The burn worked out from transactions, even when an override is in use. */
    computed_burn_cents: Cents.nullable(),
    burn_by_month: z.array(z.object({ month: z.string(), outflow_cents: z.number().int() })),
    top_categories: z.array(z.object({ name: z.string(), monthly_cents: z.number().int() })),
    cash_history: z.array(z.object({ date: DateOnly, balance_cents: z.number().int() })),
    accounts: z.array(BankAccount),
    sync: z.object({
        is_configured: z.boolean(),
        last_synced_at: IsoDateTime.nullable(),
        last_error: z.string().nullable(),
    }),
})
export type CashSummary = z.infer<typeof CashSummary>

export const UpdateBankAccountRequest = z.object({ is_included: z.boolean() })
export type UpdateBankAccountRequest = z.infer<typeof UpdateBankAccountRequest>
