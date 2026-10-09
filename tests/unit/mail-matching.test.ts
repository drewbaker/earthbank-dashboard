// Covers which email the dashboard reads: funder matching by address and domain (never free-mail
// domains), the Gmail search queries, body cleanup, forwarded-message unwrapping and forwarding tokens.
import { describe, expect, it } from 'vitest'
import { forwardingTokenFrom } from '#server/utils/mail/inbound.ts'
import { buildFunderMailQueries, buildFunderMatchIndex, matchFunder } from '#server/utils/mail/matching.ts'
import { htmlToText, stripQuotedText, unwrapForwardedMessage } from '#server/utils/mail/normalize.ts'

const index = buildFunderMatchIndex({
    funders: [
        { id: 'fnd_ubs', contactEmails: ['tom-za.hall@ubs.com'], emailDomains: ['ubs.com'] },
        { id: 'fnd_bredenkamp', contactEmails: ['arbredenkamp@gmail.com'], emailDomains: ['gmail.com'] },
    ],
})

describe('matchFunder', () => {
    it('matches exact contacts, then domains', () => {
        expect(matchFunder({ index, from: 'tom-za.hall@ubs.com', recipients: [] })).toBe('fnd_ubs')
        expect(matchFunder({ index, from: 'someone.new@ubs.com', recipients: [] })).toBe('fnd_ubs')
        expect(matchFunder({ index, from: 'drew@theearthbank.org', recipients: ['clarissa.mayer@ubs.com'] })).toBe(
            'fnd_ubs',
        )
    })

    it('never matches a free-mail domain, only the exact address', () => {
        expect(matchFunder({ index, from: 'arbredenkamp@gmail.com', recipients: [] })).toBe('fnd_bredenkamp')
        expect(matchFunder({ index, from: 'random.person@gmail.com', recipients: [] })).toBeNull()
    })
})

describe('buildFunderMailQueries', () => {
    const after = new Date('2026-10-01T00:00:00Z')

    it('covers each domain and stray address with from/to/cc terms', () => {
        const queries = buildFunderMailQueries({
            contactEmails: ['tom-za.hall@ubs.com', 'arbredenkamp@gmail.com'],
            domains: ['ubs.com', 'gmail.com'],
            after,
        })
        expect(queries).toEqual([
            '{from:ubs.com to:ubs.com cc:ubs.com from:arbredenkamp@gmail.com to:arbredenkamp@gmail.com cc:arbredenkamp@gmail.com} after:1790812800',
        ])
    })

    it('splits long lists so every query stays under the limit', () => {
        const domains = Array.from({ length: 60 }, (_, number) => `foundation-number-${number}.org`)
        const queries = buildFunderMailQueries({ contactEmails: [], domains, after, maxLength: 500 })
        expect(queries.length).toBeGreaterThan(1)
        expect(queries.every(query => query.length <= 500)).toBe(true)
        expect(queries.join(' ')).toContain('foundation-number-59.org')
    })
})

describe('email text cleanup', () => {
    it('drops quoted history and signatures', () => {
        const text =
            'Great news, approved for $500k.\n\nBest,\nTom\n--\nTom Hall | UBS\n\nOn Mon, Oct 5, 2026 at 9:00 AM Drew <drew@theearthbank.org> wrote:\n> Any update?'
        expect(stripQuotedText({ text })).toBe('Great news, approved for $500k.\n\nBest,\nTom')
    })

    it('converts HTML to text', () => {
        expect(htmlToText({ html: '<p>Hello&nbsp;Drew</p><p>We&#39;re in.<br>Tom</p><style>p{}</style>' })).toBe(
            "Hello Drew\nWe're in.\nTom",
        )
    })

    it('unwraps a Gmail forward to the original sender and text', () => {
        const forwarded = unwrapForwardedMessage({
            text: 'FYI\n\n---------- Forwarded message ---------\nFrom: Jane Doe <jane@newfund.org>\nDate: Tue, Oct 6, 2026 at 4:12 PM\nSubject: Earth Bank\nTo: <drew@gmail.com>\n\nWe would love to talk about a $250k grant.',
        })
        expect(forwarded).toMatchObject({
            from: 'jane@newfund.org',
            to: ['drew@gmail.com'],
            subject: 'Earth Bank',
            text: 'We would love to talk about a $250k grant.',
        })
    })
})

describe('forwardingTokenFrom', () => {
    it('finds the token in the private address', () => {
        expect(
            forwardingTokenFrom({
                recipients: ['Updates+abc123@MAIL.theearthbank.org'],
                domain: 'mail.theearthbank.org',
            }),
        ).toBe('abc123')
        expect(
            forwardingTokenFrom({ recipients: ['updates@mail.theearthbank.org'], domain: 'mail.theearthbank.org' }),
        ).toBeNull()
    })
})
