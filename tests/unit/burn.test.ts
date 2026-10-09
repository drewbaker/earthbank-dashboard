// Covers the burn rate: only operating spend counts, refunds net off, transfers and exclusions don't
// count, and the current partial month is never included.
import { describe, expect, it } from 'vitest'
import type { BurnTransaction } from '#server/utils/burn.ts'
import { computeMonthlyBurn } from '#server/utils/burn.ts'

/**
 * A test transaction.
 *
 * @param overrides - Fields to change.
 * @returns The transaction.
 */
function transaction(overrides: Partial<BurnTransaction>): BurnTransaction {
    return {
        bookedOn: '2026-09-10',
        amountCents: -1_000_000,
        parentCategory: 'EXPENSE',
        categoryName: 'Payroll',
        isExcluded: false,
        ...overrides,
    }
}

describe('computeMonthlyBurn', () => {
    it('averages operating spend over the last full months', () => {
        const result = computeMonthlyBurn({
            today: '2026-10-09',
            lookbackMonths: 3,
            excludedCategories: [],
            transactions: [
                transaction({ bookedOn: '2026-07-05', amountCents: -3_000_000 }),
                transaction({ bookedOn: '2026-08-05', amountCents: -6_000_000 }),
                transaction({ bookedOn: '2026-09-05', amountCents: -9_000_000 }),
                // Current month: ignored.
                transaction({ bookedOn: '2026-10-02', amountCents: -50_000_000 }),
            ],
        })
        expect(result.monthlyBurnCents).toBe(6_000_000)
        expect(result.months).toEqual([
            { month: '2026-07', outflowCents: 3_000_000 },
            { month: '2026-08', outflowCents: 6_000_000 },
            { month: '2026-09', outflowCents: 9_000_000 },
        ])
    })

    it('ignores transfers, grant income and excluded spend, and nets refunds', () => {
        const result = computeMonthlyBurn({
            today: '2026-10-09',
            lookbackMonths: 1,
            excludedCategories: ['Loan repayment'],
            transactions: [
                transaction({ amountCents: -4_000_000 }),
                transaction({ amountCents: 1_000_000, categoryName: 'Software' }),
                transaction({
                    amountCents: -20_000_000,
                    parentCategory: 'CURRENT_ASSET',
                    categoryName: 'Transfer to savings',
                }),
                transaction({ amountCents: 50_000_000, parentCategory: 'INCOME', categoryName: 'Grants' }),
                transaction({ amountCents: -5_000_000, categoryName: 'Loan repayment' }),
                transaction({ amountCents: -7_000_000, isExcluded: true }),
                transaction({ amountCents: -500_000, parentCategory: null, categoryName: null }),
            ],
        })
        expect(result.monthlyBurnCents).toBe(3_500_000)
        expect(result.topCategories).toEqual([
            { name: 'Payroll', monthlyCents: 4_000_000 },
            { name: 'Uncategorized', monthlyCents: 500_000 },
        ])
    })

    it('has no burn when there is no history', () => {
        expect(
            computeMonthlyBurn({ today: '2026-10-09', lookbackMonths: 3, excludedCategories: [], transactions: [] })
                .monthlyBurnCents,
        ).toBeNull()
    })
})
