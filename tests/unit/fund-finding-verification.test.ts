// Covers the checks that keep made-up research out: findings need a page the run fetched, a quote
// that is really on that page, enough confidence and a sane value; links need to have been seen.
import { describe, expect, it } from 'vitest'
import {
    buildResearchEvidence,
    findingValueKey,
    isEmailPublished,
    normalizeUrl,
    partialDateStart,
    quoteMentions,
    verifyFinding,
} from '#server/utils/funds/verify-finding.ts'

const now = new Date('2026-10-17T00:00:00Z')
const evidence = buildResearchEvidence({
    pages: [
        {
            url: 'https://www.iungocapital.com/about/',
            title: 'About Iungo',
            text: 'Iungo Capital was founded in 2017. We provide  asset finance of $50,000 to $500,000 to SMEs in East Africa. Contact: info@iungocapital.com',
        },
    ],
    searchResults: [{ url: 'https://www.linkedin.com/company/iungo-capital/', title: 'Iungo Capital | LinkedIn' }],
})

/**
 * Run verifyFinding with defaults.
 *
 * @param input - Overrides.
 * @returns The verification.
 */
function check(input: Partial<Parameters<typeof verifyFinding>[0]>) {
    return verifyFinding({
        field: 'year_established',
        value: { year: 2017 },
        sourceUrls: ['https://iungocapital.com/about'],
        quote: 'Iungo Capital was founded in 2017.',
        confidence: 0.9,
        minConfidence: 0.7,
        evidence,
        now,
        ...input,
    })
}

describe('verifyFinding', () => {
    it('keeps a finding quoted from a fetched page (URL and whitespace differences ignored)', () => {
        const result = check({
            quote: 'provide asset finance of $50,000 to $500,000',
            field: 'loan_types',
            value: { types: ['asset_finance'] },
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.sources).toEqual([
                {
                    url: 'https://www.iungocapital.com/about/',
                    title: 'About Iungo',
                    quote: 'provide asset finance of $50,000 to $500,000',
                },
            ])
        }
    })

    it('drops findings below the confidence floor', () => {
        expect(check({ confidence: 0.6 })).toEqual({ ok: false, reason: 'low_confidence' })
    })

    it('drops findings whose quote is not on the page', () => {
        expect(check({ quote: 'Iungo Capital was founded in 2015.' })).toEqual({ ok: false, reason: 'quote_not_found' })
    })

    it('drops findings citing a page the run never fetched', () => {
        expect(check({ sourceUrls: ['https://example.com/made-up'] })).toEqual({ ok: false, reason: 'quote_not_found' })
    })

    it('drops quotes too short to prove anything', () => {
        expect(check({ quote: '2017' })).toEqual({ ok: false, reason: 'quote_not_found' })
    })

    it('range-checks values', () => {
        expect(check({ value: { year: 2031 } })).toEqual({ ok: false, reason: 'out_of_range' })
        expect(check({ field: 'headquarters', value: { city: 'Nairobi', country: 'XX' } })).toEqual({
            ok: false,
            reason: 'out_of_range',
        })
        expect(check({ field: 'check_size', value: { min: 500000, max: 50000, currency: 'USD', note: null } })).toEqual(
            {
                ok: false,
                reason: 'out_of_range',
            },
        )
    })

    it('rejects unknown fields, bad shapes and public records (those come from cross-referencing)', () => {
        expect(check({ field: 'favorite_color', value: {} })).toEqual({ ok: false, reason: 'unknown_field' })
        expect(check({ field: 'public_record', value: {} })).toEqual({ ok: false, reason: 'unknown_field' })
        expect(check({ value: { year: 'twenty' } })).toEqual({ ok: false, reason: 'invalid_value' })
    })

    it('uppercases codes and keeps only valid focus codes', () => {
        const result = check({
            field: 'geographic_focus',
            value: { codes: ['ke', 'region:eastern_africa', 'atlantis'], text: 'East Africa' },
            quote: 'to SMEs in East Africa',
        })
        expect(result.ok && result.value.value).toEqual({ codes: ['KE', 'region:eastern_africa'], text: 'East Africa' })
    })

    it('accepts a LinkedIn company page seen in search results, without a quote', () => {
        const result = check({
            field: 'linkedin_url',
            value: { url: 'https://linkedin.com/company/iungo-capital' },
            sourceUrls: [],
            quote: null,
        })
        expect(result.ok).toBe(true)
    })

    it('refuses a LinkedIn link nobody saw, and personal profiles as the company page', () => {
        expect(
            check({ field: 'linkedin_url', value: { url: 'https://www.linkedin.com/company/other/' }, quote: null }).ok,
        ).toBe(false)
        expect(
            check({ field: 'linkedin_url', value: { url: 'https://www.linkedin.com/in/someone/' }, quote: null }),
        ).toEqual({
            ok: false,
            reason: 'out_of_range',
        })
    })
})

describe('helpers', () => {
    it('normalizes URLs so the same page compares equal', () => {
        expect(normalizeUrl({ url: 'http://WWW.Example.com/path/?utm_source=x&id=2#top' })).toBe(
            'https://example.com/path?id=2',
        )
    })

    it('finds published emails only when a fetched page shows them', () => {
        expect(isEmailPublished({ email: 'info@iungocapital.com', evidence })).toBe(true)
        expect(isEmailPublished({ email: 'ceo@iungocapital.com', evidence })).toBe(false)
    })

    it('checks a quote names who it is about', () => {
        expect(quoteMentions({ quote: 'She was a partner at Acumen Capital Ltd.', name: 'Acumen Capital' })).toBe(true)
        expect(quoteMentions({ quote: 'She was a partner at a fund.', name: 'Acumen Capital' })).toBe(false)
    })

    it('keys list findings by what identifies them', () => {
        expect(findingValueKey({ field: 'deal', value: { borrower: 'SunCulture Ltd', date: '2024-03' } })).toBe(
            'sunculture|2024',
        )
        expect(findingValueKey({ field: 'aum', value: { currency: 'USD', amount: 5 } })).toBe(
            findingValueKey({ field: 'aum', value: { amount: 5, currency: 'USD' } }),
        )
    })

    it('reads partial dates as the first day they cover', () => {
        expect(partialDateStart({ text: '2024' })?.toISOString().slice(0, 10)).toBe('2024-01-01')
        expect(partialDateStart({ text: '2024-06' })?.toISOString().slice(0, 10)).toBe('2024-06-01')
        expect(partialDateStart({ text: 'June 2024' })).toBeNull()
    })
})
