// Covers how a fund's website and LinkedIn page are told apart from same-named organizations:
// candidate ranking through the impact lens and hints, website–LinkedIn pairs, and when a pick is used.
import { describe, expect, it } from 'vitest'
import { acceptPick, confirmedPairs, scoreWebsiteCandidate } from '#server/utils/funds/identity.ts'

describe('scoreWebsiteCandidate', () => {
    it('ranks the impact lender above a same-named company in another business', () => {
        const hints = ['United States; Bronx, New York']
        const lender = {
            url: 'https://springbankny.com/',
            title: 'Spring Bank',
            snippet: 'A community development bank (CDFI) in the Bronx offering small business loans.',
            homeText: null,
            signals: ['Listed on ofn.org'],
        }
        const other = {
            url: 'https://springbank.co.uk/',
            title: 'Spring Bank Garden Centre',
            snippet: 'Plants, gifts and a cafe.',
            homeText: null,
            signals: [],
        }
        expect(scoreWebsiteCandidate({ fundName: 'Spring Bank', hints, candidate: lender })).toBeGreaterThan(
            scoreWebsiteCandidate({ fundName: 'Spring Bank', hints, candidate: other }),
        )
    })
})

describe('confirmedPairs', () => {
    it('pairs a website with the LinkedIn page it links to, or whose description names its domain', () => {
        const pairs = confirmedPairs({
            websites: [
                { url: 'https://iungocapital.com/', linkedinLinks: ['https://www.linkedin.com/company/iungo-capital'] },
                { url: 'https://enduringplanet.com/', linkedinLinks: [] },
            ],
            linkedins: [
                { url: 'https://www.linkedin.com/company/iungo-capital', title: 'Iungo Capital', snippet: null },
                {
                    url: 'https://www.linkedin.com/company/enduring-planet',
                    title: 'Enduring Planet | LinkedIn',
                    snippet: 'Website: enduringplanet.com',
                },
                { url: 'https://www.linkedin.com/company/unrelated', title: 'Unrelated', snippet: null },
            ],
        })
        expect(pairs).toEqual([
            { website: 'https://iungocapital.com/', linkedin: 'https://www.linkedin.com/company/iungo-capital' },
            { website: 'https://enduringplanet.com/', linkedin: 'https://www.linkedin.com/company/enduring-planet' },
        ])
    })
})

describe('acceptPick', () => {
    const seen = ['https://springbankny.com/', 'https://springbank.co.uk/']

    it('ignores a URL that was never a candidate, however sure the model is', () => {
        expect(acceptPick({ url: 'https://made-up.example/', confidence: 0.99, seen, isConfirmed: () => false })).toBe(
            null,
        )
    })

    it('needs 0.8 on its own, but less when the website and LinkedIn page confirm each other', () => {
        expect(
            acceptPick({ url: 'https://springbankny.com/about', confidence: 0.6, seen, isConfirmed: () => false }),
        ).toBe(null)
        expect(
            acceptPick({ url: 'https://springbankny.com/about', confidence: 0.6, seen, isConfirmed: () => true }),
        ).toBe('https://springbankny.com/about')
        expect(acceptPick({ url: 'https://springbankny.com/', confidence: 0.85, seen, isConfirmed: () => false })).toBe(
            'https://springbankny.com/',
        )
    })
})
