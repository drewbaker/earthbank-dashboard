// Covers the last-contact colors on the pipeline: fine for 5 days, yellow after 5, red after 10.
import { describe, expect, it } from 'vitest'
import { contactStaleness, daysSinceContact } from '#shared/utils/contact-staleness.ts'

const TODAY = '2026-10-16'

describe('contactStaleness', () => {
    it.each([
        ['2026-10-16', 'recent'],
        ['2026-10-11', 'recent'],
        ['2026-10-10', 'stale'],
        ['2026-10-06', 'stale'],
        ['2026-10-05', 'overdue'],
        ['2025-12-01', 'overdue'],
    ] as const)('contact on %s is %s', (lastContactAt, expected) => {
        expect(contactStaleness({ lastContactAt, today: TODAY })).toBe(expected)
    })

    it('is "never" with no contact logged', () => {
        expect(contactStaleness({ lastContactAt: null, today: TODAY })).toBe('never')
    })

    it('never counts a future date as negative days', () => {
        expect(daysSinceContact({ lastContactAt: '2026-10-20', today: TODAY })).toBe(0)
    })
})
