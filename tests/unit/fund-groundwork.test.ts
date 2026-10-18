// Covers the groundwork before research: which pages of a fund's site are read first, and how a
// data provider's company record becomes findings (headcount band, founding year, HQ, profiles).
import { describe, expect, it } from 'vitest'
import { choosePagesToRead, findingsFromCompanyRecord } from '#server/utils/funds/groundwork.ts'

describe('choosePagesToRead', () => {
    it('reads the home page, then team, about, lending, portfolio, news, impact and contact pages', () => {
        const pages = choosePagesToRead({
            homeUrl: 'https://enduringplanet.com/',
            maxPages: 8,
            urls: [
                'https://enduringplanet.com',
                'https://enduringplanet.com/about/case-studies/dexmat',
                'https://enduringplanet.com/about/team',
                'https://enduringplanet.com/about/FAQs',
                'https://enduringplanet.com/about/case-studies',
                'https://enduringplanet.com/about/careers',
                'https://enduringplanet.com/contact',
                'https://enduringplanet.com/insights',
                'https://enduringplanet.com/funding',
                'https://enduringplanet.com/privacy',
                'https://enduringplanet.com/impact-report.pdf',
                'https://accounting.enduringplanet.com',
                'https://other.com/team',
            ],
        })
        expect(pages[0]).toBe('https://enduringplanet.com/')
        expect(pages).toEqual(
            expect.arrayContaining([
                'https://enduringplanet.com/about/team',
                'https://enduringplanet.com/funding',
                'https://enduringplanet.com/about/case-studies',
                'https://enduringplanet.com/insights',
                'https://enduringplanet.com/contact',
            ]),
        )
        expect(pages).not.toContain('https://enduringplanet.com/privacy')
        expect(pages).not.toContain('https://enduringplanet.com/about/careers')
        expect(pages).not.toContain('https://enduringplanet.com/impact-report.pdf')
        expect(pages).not.toContain('https://other.com/team')
        expect(pages.length).toBeLessThanOrEqual(8)
    })
})

describe('findingsFromCompanyRecord', () => {
    it('turns the record into validated findings sourced to the data provider', () => {
        const findings = findingsFromCompanyRecord({
            sourceUrl: 'https://iungocapital.com/',
            now: new Date('2026-10-17T00:00:00Z'),
            company: {
                provider: 'datalegion',
                matchConfidence: 'high',
                name: 'Iungo Capital',
                description: null,
                founded: 2016,
                size: '11-50',
                linkedinUrl: 'https://www.linkedin.com/company/iungocapital',
                headquarters: { city: 'Nairobi', countryCode: 'KE' },
                socials: [
                    { network: 'crunchbase', url: 'https://www.crunchbase.com/organization/iungo-capital' },
                    { network: 'linkedin', url: 'https://www.linkedin.com/company/iungo-capital' },
                ],
            },
        })
        expect(Object.fromEntries(findings.map(finding => [finding.field, finding.value]))).toEqual({
            employee_count: { count: null, range: '11-50' },
            year_established: { year: 2016 },
            headquarters: { city: 'Nairobi', country: 'KE' },
            linkedin_url: { url: 'https://www.linkedin.com/company/iungocapital' },
            social_account: { platform: 'Crunchbase', url: 'https://www.crunchbase.com/organization/iungo-capital' },
        })
        expect(findings[0]!.sources[0]).toEqual({
            url: 'https://iungocapital.com/',
            title: 'Iungo Capital record (datalegion)',
            kind: 'data_provider',
            quote: 'datalegion: headcount 11-50; founded 2016; HQ Nairobi, KE',
        })
    })
})

describe('companyRecordFindings', () => {
    it('gives the website when the record was found by LinkedIn page', async () => {
        const { companyRecordFindings } = await import('#server/utils/funds/groundwork.ts')
        const reader = {
            lookupCompany: async ({ domain, linkedinUrl }: { domain: string | null; linkedinUrl: string | null }) => {
                expect({ domain, linkedinUrl }).toEqual({
                    domain: null,
                    linkedinUrl: 'https://www.linkedin.com/company/spring-bank-ny',
                })
                return {
                    company: {
                        provider: 'datalegion',
                        matchConfidence: 'high',
                        name: 'Spring Bank NY',
                        domain: 'spring.bank',
                        description: null,
                        founded: 2007,
                        size: '11-50',
                        linkedinUrl: 'https://www.linkedin.com/company/spring-bank-ny',
                        headquarters: null,
                        socials: [],
                    },
                    failure: null,
                    credits: 10,
                }
            },
        } as unknown as Parameters<typeof companyRecordFindings>[0]['reader']
        const result = await companyRecordFindings({
            websiteUrl: null,
            linkedinUrl: 'https://www.linkedin.com/company/spring-bank-ny',
            reader,
            now: new Date('2026-10-17T00:00:00Z'),
        })
        expect(result.websiteUrl).toBe('https://spring.bank/')
        expect(result.findings.map(finding => finding.field)).toEqual([
            'employee_count',
            'year_established',
            'linkedin_url',
        ])
    })
})
