// Covers how an email shows on the funder page: sent or received, who the other side is, and a Gmail
// link that finds it by Message-ID in the viewer's own inbox. Sensitive subjects stay hidden.
import { describe, expect, it } from 'vitest'
import { serializeEmailEvidence } from '#server/utils/serializers/email-evidence.ts'

/**
 * An evidence row as Prisma returns it.
 *
 * @param overrides - Fields to change.
 * @returns The row.
 */
function evidenceRow(overrides: Record<string, unknown>) {
    return {
        id: 'eml_1',
        source: 'gmail',
        message_id_header: '<abc.123@mail.gmail.com>',
        mailbox_user_id: null,
        from_address: 'tom@ubs.com',
        to_addresses: ['drew@theearthbank.org'],
        sent_at: new Date('2026-10-01T12:00:00Z'),
        subject: 'Budget question',
        summary: 'Asked for the design grant budget.',
        is_relevant: true,
        is_sensitive: false,
        funder_id: 'fnd_1',
        model: null,
        confidence: null,
        created_at: new Date(),
        mailbox_user: null,
        _count: { change_events: 2 },
        ...overrides,
    } as never
}

describe('serializeEmailEvidence', () => {
    it('marks funder email as received from the funder, with a Gmail link for the viewer', () => {
        const email = serializeEmailEvidence({ evidence: evidenceRow({}), viewerEmail: 'leslie@theearthbank.org' })
        expect(email).toMatchObject({ direction: 'received', counterpart: 'tom@ubs.com', change_count: 2 })
        expect(email.gmail_url).toBe(
            'https://mail.google.com/mail/?authuser=leslie%40theearthbank.org#search/rfc822msgid%3Aabc.123%40mail.gmail.com',
        )
    })

    it("marks Earth Bank's own email as sent, to the funder rather than to colleagues", () => {
        const email = serializeEmailEvidence({
            evidence: evidenceRow({
                from_address: 'drew@resolvefund.org',
                to_addresses: ['leslie@theearthbank.org', 'tom@ubs.com'],
            }),
        })
        expect(email).toMatchObject({ direction: 'sent', counterpart: 'tom@ubs.com' })
    })

    it('hides sensitive subjects and has no link without a Message-ID', () => {
        const email = serializeEmailEvidence({
            evidence: evidenceRow({ is_sensitive: true, message_id_header: 'gmail:18c2f' }),
        })
        expect(email.subject).toBeNull()
        expect(email.gmail_url).toBeNull()
    })
})
