// Covers how lenders are told apart: names without legal forms, bare website domains, and how
// source pages are labelled (fund site, LinkedIn, DFI list, government, press release).
import { describe, expect, it } from 'vitest'
import { classifySourceKind } from '#server/utils/funds/research.ts'
import { organizationNameKey, websiteDomain } from '#shared/funds/organization-names.ts'

describe('organizationNameKey', () => {
    it('ignores legal forms, punctuation and accents', () => {
        expect(organizationNameKey({ name: 'Iungo Capital Ltd.' })).toBe(organizationNameKey({ name: 'iungo capital' }))
        expect(organizationNameKey({ name: 'Prestamype S.A.C.' })).toBe('prestamype')
        expect(organizationNameKey({ name: 'Société Générale' })).toBe('societe generale')
        expect(organizationNameKey({ name: 'The Ltd' })).toBe('the ltd')
    })
})

describe('websiteDomain', () => {
    it('keeps the bare host', () => {
        expect(websiteDomain({ url: 'https://www.EnduringPlanet.com/about' })).toBe('enduringplanet.com')
        expect(websiteDomain({ url: 'clarmondial.com' })).toBe('clarmondial.com')
        expect(websiteDomain({ url: 'not a url' })).toBeNull()
        expect(websiteDomain({ url: null })).toBeNull()
    })
})

describe('classifySourceKind', () => {
    it('labels pages by where they are', () => {
        expect(classifySourceKind({ url: 'https://www.linkedin.com/company/x', fundDomain: null })).toBe('linkedin')
        expect(classifySourceKind({ url: 'https://blog.iungocapital.com/post', fundDomain: 'iungocapital.com' })).toBe(
            'fund_website',
        )
        expect(classifySourceKind({ url: 'https://www.norfund.no/investment/x', fundDomain: null })).toBe(
            'dfi_database',
        )
        expect(classifySourceKind({ url: 'https://www.cdfifund.gov/awards', fundDomain: null })).toBe(
            'government_database',
        )
        expect(classifySourceKind({ url: 'https://www.prnewswire.com/news/x', fundDomain: null })).toBe('press_release')
        expect(classifySourceKind({ url: 'https://example.org/report.pdf', fundDomain: null })).toBe('report')
        expect(classifySourceKind({ url: 'https://techcabal.com/2025/01/x', fundDomain: null })).toBe('news')
    })
})

describe('canonicalLinkedinUrl', () => {
    it('uses www.linkedin.com without query or trailing slash', async () => {
        const { canonicalLinkedinUrl } = await import('#shared/funds/organization-names.ts')
        expect(canonicalLinkedinUrl({ url: 'https://ug.linkedin.com/in/badi-arorwa-0417082a/?trk=x' })).toBe(
            'https://www.linkedin.com/in/badi-arorwa-0417082a',
        )
        expect(canonicalLinkedinUrl({ url: 'https://linkedin.com/company/iungocapital' })).toBe(
            'https://www.linkedin.com/company/iungocapital',
        )
        expect(canonicalLinkedinUrl({ url: 'https://example.com/in/x' })).toBe('https://example.com/in/x')
    })
})
