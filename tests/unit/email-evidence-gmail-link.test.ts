// Covers who gets "Open in Gmail": only the person whose inbox the email was read from.
import { describe, expect, it } from 'vitest'
import { serializeEmailEvidence } from '#server/utils/serializers/email-evidence.ts'

const leslie = { id: 'usr_leslie', email: 'leslie@theearthbank.org' }
const drew = { id: 'usr_drew', email: 'drew@theearthbank.org' }

/**
 * An evidence row read from Leslie's Gmail.
 *
 * @returns The row.
 */
function evidenceFromLesliesInbox() {
    return {
        id: 'eml_1',
        source: 'gmail',
        message_id_header: '<abc@rockfound.org>',
        mailbox_user_id: leslie.id,
        from_address: 'croth@rockfound.org',
        to_addresses: ['leslie@theearthbank.org'],
        sent_at: new Date('2026-10-08T12:00:00Z'),
        subject: 'Re: updated materials',
        summary: 'Revised proposal received.',
        is_relevant: true,
        is_sensitive: false,
        funder_id: 'fnd_1',
        model: null,
        confidence: null,
        created_at: new Date('2026-10-08T12:00:00Z'),
        mailbox_user: {
            id: leslie.id,
            name: 'Leslie Labruto',
            avatar_url: null,
        },
    } as unknown as Parameters<typeof serializeEmailEvidence>[0]['evidence']
}

describe('serializeEmailEvidence gmail_url', () => {
    it('opens in the mailbox owner’s Gmail', () => {
        const url = serializeEmailEvidence({ evidence: evidenceFromLesliesInbox(), viewer: leslie }).gmail_url
        expect(url).toContain('authuser=leslie%40theearthbank.org')
        expect(url).toContain(encodeURIComponent('rfc822msgid:abc@rockfound.org'))
    })

    it('is left out for anyone else', () => {
        expect(serializeEmailEvidence({ evidence: evidenceFromLesliesInbox(), viewer: drew }).gmail_url).toBeNull()
        expect(serializeEmailEvidence({ evidence: evidenceFromLesliesInbox() }).gmail_url).toBeNull()
    })
})
