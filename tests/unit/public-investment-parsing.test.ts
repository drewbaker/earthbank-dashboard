// Covers reading public investment lists: HTML to text with links kept, AI-extracted rows shaped
// into records, USAspending awards mapped without AI, and the private-address guard on fetches.
import { describe, expect, it } from 'vitest'
import { htmlToText, rowsFromExtraction, usaspendingRows } from '#server/utils/funds/public-investments.ts'
import { isPrivateAddress } from '#server/utils/safe-fetch.ts'

describe('htmlToText', () => {
    it('drops scripts and keeps links as absolute URLs', () => {
        const text = htmlToText({
            html: '<head><title>x</title></head><script>alert(1)</script><ul><li><a href="/project-detail/67316">Iungo Capital</a> USD 5m</li></ul><a href="?page=2">Next page</a>',
            baseUrl: 'https://www.fmo.nl/world-map',
        })
        expect(text).toContain('Iungo Capital (https://www.fmo.nl/project-detail/67316)')
        expect(text).toContain('Next page (https://www.fmo.nl/world-map?page=2)')
        expect(text).not.toContain('alert')
    })
})

describe('rowsFromExtraction', () => {
    it('shapes rows, converts amounts and drops unusable ones', () => {
        const rows = rowsFromExtraction({
            pageUrl: 'https://www.fmo.nl/world-map',
            extracted: [
                {
                    recipient_name: 'Iungo Capital Ltd',
                    external_id: '67316',
                    url: 'https://www.fmo.nl/project-detail/67316',
                    amount: 5_000_000,
                    currency: 'eur',
                    committed_on: '2025-03',
                    country: 'ke',
                    instrument: 'Loan',
                    description: 'Asset finance for SMEs',
                    is_intermediary: true,
                },
                {
                    recipient_name: '  ',
                    external_id: null,
                    url: null,
                    amount: null,
                    currency: null,
                    committed_on: null,
                    country: null,
                    instrument: null,
                    description: null,
                    is_intermediary: false,
                },
            ],
        })
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            externalId: '67316',
            recipientNameKey: 'iungo capital',
            amountCents: BigInt(Math.round(5_000_000 * 1.08 * 100)),
            currency: 'EUR',
            country: 'KE',
            isIntermediary: true,
        })
        expect(rows[0]!.committedOn?.toISOString().slice(0, 10)).toBe('2025-03-01')
    })
})

describe('usaspendingRows', () => {
    it('maps awards to lender records and pages on', () => {
        const { rows, nextCursor } = usaspendingRows({
            page: 1,
            payload: {
                results: [
                    {
                        'Award ID': 'CDFI-2024-001',
                        'Recipient Name': 'Community Lending Fund Inc',
                        'Award Amount': 1_250_000,
                        'Start Date': '2024-09-30',
                        Description: 'CDFI Program financial assistance',
                        generated_internal_id: 'ASST_NON_123',
                    },
                ],
                page_metadata: { hasNext: true },
            },
        })
        expect(nextCursor).toBe('2')
        expect(rows[0]).toMatchObject({
            externalId: 'CDFI-2024-001',
            recipientNameKey: 'community lending fund',
            amountCents: 125_000_000n,
            url: 'https://www.usaspending.gov/award/ASST_NON_123',
            isIntermediary: true,
        })
    })
})

describe('isPrivateAddress', () => {
    it('blocks private, loopback and link-local addresses', () => {
        for (const address of [
            '10.0.0.1',
            '127.0.0.1',
            '169.254.169.254',
            '172.16.5.4',
            '192.168.1.1',
            '::1',
            'fd00::1',
            '::ffff:127.0.0.1',
        ]) {
            expect(isPrivateAddress({ address })).toBe(true)
        }
        for (const address of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) {
            expect(isPrivateAddress({ address })).toBe(false)
        }
    })
})
