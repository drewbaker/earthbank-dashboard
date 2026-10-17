// Covers how a fund's sortable values and completeness are worked out from its findings: newest
// scalar wins, latest close, working-capital loans (≥ $500K matters), and currency conversion.
import { describe, expect, it } from 'vitest'
import { deriveFundResearchValues } from '#server/utils/funds/research-values.ts'
import { diligenceCompleteness, researchCompleteness } from '#shared/funds/completeness.ts'
import { formatCurrencyAmount, toUsdCents } from '#shared/funds/money.ts'

const earlier = new Date('2026-01-01T00:00:00Z')
const later = new Date('2026-06-01T00:00:00Z')

describe('deriveFundResearchValues', () => {
    it('uses the newest value, the latest close and converts currencies', () => {
        const values = deriveFundResearchValues({
            findings: [
                { field: 'aum', value: { amount: 900_000_000, currency: 'EUR', as_of: '2023' }, created_at: earlier },
                { field: 'aum', value: { amount: 1_000_000_000, currency: 'EUR', as_of: '2025' }, created_at: later },
                {
                    field: 'fund_raise',
                    value: {
                        fund_name: 'Fund I',
                        size: { amount: 20_000_000, currency: 'USD' },
                        close_type: 'final_close',
                        closed_on: '2019-05',
                    },
                    created_at: earlier,
                },
                {
                    field: 'fund_raise',
                    value: {
                        fund_name: 'Fund II',
                        size: { amount: 75_000_000, currency: 'USD' },
                        close_type: 'first_close',
                        closed_on: '2025-02',
                    },
                    created_at: earlier,
                },
                { field: 'headquarters', value: { city: 'Nairobi', country: 'KE' }, created_at: earlier },
            ],
            hasPrincipals: false,
            hasWorkHistory: false,
        })
        expect(values.aum_cents).toBe(BigInt(Math.round(1_000_000_000 * 1.08 * 100)))
        expect(values.latest_fund_size_cents).toBe(7_500_000_000n)
        expect(values.last_fund_close_on?.toISOString().slice(0, 10)).toBe('2025-02-01')
        expect(values.hq_country).toBe('KE')
    })

    it('takes the largest working-capital deal, else the top of the check size when they offer it', () => {
        const fromDeals = deriveFundResearchValues({
            findings: [
                { field: 'loan_types', value: { types: ['term_debt'] }, created_at: earlier },
                {
                    field: 'deal',
                    value: {
                        borrower: 'A',
                        amount: { amount: 750_000, currency: 'USD' },
                        loan_type: 'trade_finance',
                        date: null,
                        country: null,
                        description: null,
                    },
                    created_at: earlier,
                },
                {
                    field: 'deal',
                    value: {
                        borrower: 'B',
                        amount: { amount: 2_000_000, currency: 'USD' },
                        loan_type: 'project_debt',
                        date: null,
                        country: null,
                        description: null,
                    },
                    created_at: earlier,
                },
            ],
            hasPrincipals: false,
            hasWorkHistory: false,
        })
        expect(fromDeals.has_working_capital_loans).toBe(true)
        expect(fromDeals.max_working_capital_loan_cents).toBe(75_000_000n)

        const fromCheckSize = deriveFundResearchValues({
            findings: [
                { field: 'loan_types', value: { types: ['working_capital'] }, created_at: earlier },
                {
                    field: 'check_size',
                    value: { min: 100_000, max: 1_000_000, currency: 'USD', note: null },
                    created_at: earlier,
                },
            ],
            hasPrincipals: false,
            hasWorkHistory: false,
        })
        expect(fromCheckSize.max_working_capital_loan_cents).toBe(100_000_000n)

        const none = deriveFundResearchValues({ findings: [], hasPrincipals: false, hasWorkHistory: false })
        expect(none.has_working_capital_loans).toBe(false)
        expect(none.research_completeness).toBe(0)
    })
})

describe('completeness', () => {
    it('weights research fields and counts the team', () => {
        const thin = researchCompleteness({
            filledFields: ['website_url'],
            hasPrincipals: false,
            hasWorkHistory: false,
        })
        const rich = researchCompleteness({
            filledFields: ['aum', 'check_size', 'loan_types', 'deal'],
            hasPrincipals: true,
            hasWorkHistory: true,
        })
        expect(thin).toBeGreaterThan(0)
        expect(rich).toBeGreaterThan(thin)
        expect(researchCompleteness({ filledFields: [], hasPrincipals: true, hasWorkHistory: true })).toBeLessThan(100)
    })

    it('counts answered diligence questions', () => {
        expect(diligenceCompleteness({ answeredCount: 0 })).toBe(0)
        expect(diligenceCompleteness({ answeredCount: 2 })).toBe(40)
        expect(diligenceCompleteness({ answeredCount: 9 })).toBe(100)
    })
})

describe('money', () => {
    it('converts listed currencies and refuses unknown ones', () => {
        expect(toUsdCents({ amount: 1_000, currency: 'usd' })).toBe(100_000)
        expect(toUsdCents({ amount: 1_000, currency: 'EUR' })).toBe(108_000)
        expect(toUsdCents({ amount: 1_000, currency: 'XYZ' })).toBeNull()
        expect(toUsdCents({ amount: -5, currency: 'USD' })).toBeNull()
    })

    it('formats amounts compactly in their own currency', () => {
        expect(formatCurrencyAmount({ amount: 1_500_000, currency: 'USD' })).toBe('$1.5M')
        expect(formatCurrencyAmount({ amount: 1_000_000_000, currency: 'EUR' })).toBe('€1B')
    })
})
