// Covers who an email is credited to on the Activity page: the sender, else the first team member it
// was addressed to (To before Cc), never just whichever CC'd inbox synced it first.
import { describe, expect, it } from 'vitest'
import { emailOwnerUserId } from '#server/utils/mail/attribution.ts'

const TEAM = [
    { id: 'usr_drew', email: 'drew@theearthbank.org' },
    { id: 'usr_leslie', email: 'leslie@theearthbank.org' },
    { id: 'usr_steve', email: 'steve@theearthbank.org' },
]
const DOMAINS = { workspaceDomain: 'theearthbank.org', internalDomains: ['theearthbank.org', 'resolvefund.org'] }

describe('emailOwnerUserId', () => {
    it('credits an email Leslie sent to Leslie, even when it synced from Steve (on CC)', () => {
        const ownerUserId = emailOwnerUserId({
            from: 'Leslie <leslie@theearthbank.org>',
            recipients: ['jane@ikeafoundation.org', 'steve@theearthbank.org'],
            teamMembers: TEAM,
            fallbackUserId: 'usr_steve',
            ...DOMAINS,
        })
        expect(ownerUserId).toBe('usr_leslie')
    })

    it('credits an email sent to Leslie (Steve on CC) to Leslie', () => {
        const ownerUserId = emailOwnerUserId({
            from: 'jane@ikeafoundation.org',
            recipients: ['leslie@theearthbank.org', 'steve@theearthbank.org'],
            teamMembers: TEAM,
            fallbackUserId: 'usr_steve',
            ...DOMAINS,
        })
        expect(ownerUserId).toBe('usr_leslie')
    })

    it('treats an alias domain as the same person', () => {
        const ownerUserId = emailOwnerUserId({
            from: 'leslie@resolvefund.org',
            recipients: ['jane@ikeafoundation.org'],
            teamMembers: TEAM,
            fallbackUserId: 'usr_drew',
            ...DOMAINS,
        })
        expect(ownerUserId).toBe('usr_leslie')
    })

    it('falls back to the inbox it was read from when no team member is on it (a BCC or a list)', () => {
        const ownerUserId = emailOwnerUserId({
            from: 'news@ikeafoundation.org',
            recipients: ['list@ikeafoundation.org'],
            teamMembers: TEAM,
            fallbackUserId: 'usr_steve',
            ...DOMAINS,
        })
        expect(ownerUserId).toBe('usr_steve')
    })

    it('ignores deactivated people by leaving them out of the team list', () => {
        const ownerUserId = emailOwnerUserId({
            from: 'jane@ikeafoundation.org',
            recipients: ['leslie@theearthbank.org', 'steve@theearthbank.org'],
            teamMembers: TEAM.filter(member => member.id !== 'usr_leslie'),
            fallbackUserId: 'usr_drew',
            ...DOMAINS,
        })
        expect(ownerUserId).toBe('usr_steve')
    })
})
