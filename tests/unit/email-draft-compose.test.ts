// Covers the Gmail draft message (threading headers, encoding, no header injection), reply subjects
// and who a reply goes to.
import { describe, expect, it } from 'vitest'
import { buildDraftMessage, replySubject } from '#server/utils/mail/compose.ts'
import { replyRecipients } from '#server/utils/mail/draft-reply.ts'
import type { ThreadMessage } from '#server/utils/mail/gmail.ts'

describe('buildDraftMessage', () => {
    it('threads the reply and base64-encodes the body', () => {
        const raw = buildDraftMessage({
            from: 'drew@theearthbank.org',
            to: ['tom@ubs.com'],
            cc: ['leslie@theearthbank.org'],
            subject: 'Re: Design grant',
            body: 'Hi Tom,\n\nThanks — attached.\n\nDrew',
            inReplyTo: '<abc@ubs.com>',
            references: '<root@ubs.com>',
        })
        const [headers, body] = raw.split('\r\n\r\n')
        expect(headers).toContain('To: tom@ubs.com')
        expect(headers).toContain('Cc: leslie@theearthbank.org')
        expect(headers).toContain('In-Reply-To: <abc@ubs.com>')
        expect(headers).toContain('References: <root@ubs.com> <abc@ubs.com>')
        expect(Buffer.from(body!.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(
            'Hi Tom,\r\n\r\nThanks — attached.\r\n\r\nDrew',
        )
    })

    it('keeps injected line breaks out of the headers and encodes non-ASCII subjects', () => {
        const raw = buildDraftMessage({
            from: 'drew@theearthbank.org',
            to: ['tom@ubs.com'],
            cc: [],
            subject: 'Café update\r\nBcc: attacker@example.com',
            body: 'x',
            inReplyTo: null,
            references: null,
        })
        const headers = raw.split('\r\n\r\n')[0]!
        expect(headers).not.toMatch(/^Bcc:/m)
        expect(headers).toMatch(/^Subject: =\?UTF-8\?B\?.+\?=$/m)
        expect(headers).not.toContain('In-Reply-To')
    })

    it('adds Re: once', () => {
        expect(replySubject({ subject: 'Design grant' })).toBe('Re: Design grant')
        expect(replySubject({ subject: 'RE: Design grant' })).toBe('RE: Design grant')
        expect(replySubject({ subject: '' })).toBe('Re: (no subject)')
    })
})

/**
 * A thread message for recipient tests.
 *
 * @param overrides - Fields to change.
 * @returns The message.
 */
function message(overrides: Partial<ThreadMessage>): ThreadMessage {
    return {
        gmailId: 'g1',
        messageIdHeader: '<m@ubs.com>',
        references: null,
        from: 'tom@ubs.com',
        to: ['drew@theearthbank.org'],
        cc: [],
        sentAt: new Date('2026-10-01T00:00:00Z'),
        subject: 'Design grant',
        text: 'Hello',
        ...overrides,
    }
}

describe('replyRecipients', () => {
    it('replies to the funder and keeps everyone else in Cc, except the author and their alias', () => {
        const recipients = replyRecipients({
            message: message({
                to: ['drew@theearthbank.org', 'anna@ubs.com'],
                cc: ['drew@resolvefund.org', 'leslie@theearthbank.org'],
            }),
            authorEmail: 'drew@theearthbank.org',
        })
        expect(recipients).toEqual({ to: ['tom@ubs.com'], cc: ['anna@ubs.com', 'leslie@theearthbank.org'] })
    })

    it('follows up with the same people when Earth Bank sent the last message', () => {
        const recipients = replyRecipients({
            message: message({ from: 'leslie@theearthbank.org', to: ['tom@ubs.com'], cc: ['drew@theearthbank.org'] }),
            authorEmail: 'drew@theearthbank.org',
        })
        expect(recipients).toEqual({ to: ['tom@ubs.com'], cc: [] })
    })

    it('never includes private forwarding addresses', () => {
        const recipients = replyRecipients({
            message: message({ cc: ['updates+secret@in.theearthbank.org'] }),
            authorEmail: 'drew@theearthbank.org',
        })
        expect(recipients.cc).toEqual([])
    })
})
