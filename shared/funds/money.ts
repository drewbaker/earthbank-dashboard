import { USD_PER_UNIT } from '#shared/constants/fx-rates.ts'

/**
 * Convert an amount in any listed currency to approximate US cents.
 *
 * @param input.amount - Amount in major units (e.g. 1500000 for €1.5M).
 * @param input.currency - ISO 4217 code; case-insensitive.
 * @returns Whole US cents, or null when the currency isn't in the rate table or the amount isn't usable.
 */
export function toUsdCents({ amount, currency }: { amount: number; currency: string }) {
    const rate = USD_PER_UNIT[currency.trim().toUpperCase()]
    if (rate === undefined || !Number.isFinite(amount) || amount < 0) {
        return null
    }
    return Math.round(amount * rate * 100)
}

/**
 * Format an amount in its own currency, compactly: "€1.2B", "$500K", "KES 50M".
 *
 * @param input.amount - Amount in major units.
 * @param input.currency - ISO 4217 code.
 * @returns The formatted amount.
 */
export function formatCurrencyAmount({ amount, currency }: { amount: number; currency: string }) {
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency.toUpperCase(),
            notation: 'compact',
            maximumFractionDigits: 1,
        }).format(amount)
    } catch {
        return `${currency.toUpperCase()} ${amount.toLocaleString('en-US')}`
    }
}
