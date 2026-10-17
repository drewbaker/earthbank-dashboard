// Covers guests outside the Workspace: an invitation emails a one-time link, the link signs in only
// once and only before it expires, and deactivating a guest kills their outstanding links.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

const sentEmails = vi.hoisted(() => [] as { to: string; subject: string; text: string }[])

vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueEmail: async (email: { to: string; subject: string; text: string }) => {
        sentEmails.push(email)
    },
}))

const { cleanupTestDatabase } = setupTestDatabase()
let drewId = ''

beforeAll(async () => {
    drewId = (await createTestUser({ email: 'drew@theearthbank.org', name: 'Drew Baker' })).id
})

beforeEach(() => {
    sentEmails.length = 0
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * Invite a guest and return them with the token from the emailed link.
 *
 * @param input.email - The guest's address.
 * @returns The user row and the link's token.
 */
async function inviteGuest({ email }: { email: string }) {
    const { createInvitedUser } = await import('#server/database/users.ts')
    const { sendInvitationEmail } = await import('#server/utils/sign-in-links.ts')
    const user = await createInvitedUser({ email, name: 'Guest Advisor', invitedById: drewId, invitedAt: new Date() })
    await sendInvitationEmail({ userId: user.id, email, inviterName: 'Drew Baker' })
    const url = sentEmails.at(-1)!.text.match(/https?:\/\/\S+\/login\/link#\S+/)![0]
    const token = new URLSearchParams(url.split('#')[1]).get('token')!
    return { user, token }
}

describe('guest invitations', () => {
    it('emails the guest a sign-in link from the inviter', async () => {
        const { user } = await inviteGuest({ email: 'advisor@example.org' })
        expect(user.google_sub).toBeNull()
        expect(sentEmails).toHaveLength(1)
        expect(sentEmails[0]).toMatchObject({
            to: 'advisor@example.org',
            subject: 'Drew Baker invited you to the Earth Bank Dashboard',
        })
        expect(sentEmails[0]!.text).toContain('expires in 7 days')
    })

    it('signs in once, then refuses the same link', async () => {
        const { consumeSignInLink } = await import('#server/database/sign-in-links.ts')
        const { hashToken } = await import('#server/utils/crypto.ts')
        const { user, token } = await inviteGuest({ email: 'once@example.org' })
        const first = await consumeSignInLink({ tokenHash: hashToken({ token }), now: new Date() })
        expect(first?.user_id).toBe(user.id)
        expect(first?.purpose).toBe('invitation')
        expect(await consumeSignInLink({ tokenHash: hashToken({ token }), now: new Date() })).toBeNull()
    })

    it('refuses an expired link', async () => {
        const { consumeSignInLink } = await import('#server/database/sign-in-links.ts')
        const { hashToken } = await import('#server/utils/crypto.ts')
        const { token } = await inviteGuest({ email: 'late@example.org' })
        const eightDaysLater = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
        expect(await consumeSignInLink({ tokenHash: hashToken({ token }), now: eightDaysLater })).toBeNull()
    })

    it("deletes a guest's links when they're deactivated", async () => {
        const { consumeSignInLink } = await import('#server/database/sign-in-links.ts')
        const { deactivateUser } = await import('#server/database/users.ts')
        const { hashToken } = await import('#server/utils/crypto.ts')
        const { user, token } = await inviteGuest({ email: 'removed@example.org' })
        await deactivateUser({ userId: user.id, deactivatedAt: new Date() })
        expect(await consumeSignInLink({ tokenHash: hashToken({ token }), now: new Date() })).toBeNull()
    })

    it('only treats addresses on other domains as guests', async () => {
        const { isWorkspaceEmail } = await import('#server/utils/sign-in-links.ts')
        expect(isWorkspaceEmail({ email: 'steve@theearthbank.org' })).toBe(true)
        expect(isWorkspaceEmail({ email: 'advisor@example.org' })).toBe(false)
    })
})

describe('sign-in link requests', () => {
    it('limits how often one address can ask for a link', async () => {
        const { isSignInLinkRequestLimited } = await import('#server/utils/sign-in-links.ts')
        const now = Date.now()
        const results = [1, 2, 3, 4].map(() => isSignInLinkRequestLimited({ email: 'busy@example.org', ip: null, now }))
        expect(results).toEqual([false, false, false, true])
    })
})

describe('reattributeSyncedEmails', () => {
    it("moves an email Leslie sent from Steve's CC'd inbox to Leslie", async () => {
        const { createEmailEvidence, findEmailEvidenceByIds } = await import('#server/database/email-evidence.ts')
        const { reattributeSyncedEmails } = await import('#server/utils/mail/attribution.ts')
        const leslie = await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })
        const steve = await createTestUser({ email: 'steve@theearthbank.org', name: 'Steve' })
        const evidence = await createEmailEvidence({
            source: 'gmail',
            messageIdHeader: '<cc-test@mail.example>',
            mailboxUserId: steve.id,
            fromAddress: 'leslie@theearthbank.org',
            toAddresses: ['jane@ikeafoundation.org', 'steve@theearthbank.org'],
            sentAt: new Date('2026-10-01T12:00:00Z'),
            subject: 'Concept note',
            summary: 'Leslie sent the concept note.',
            isRelevant: true,
            isSensitive: false,
            funderId: null,
            model: null,
            confidence: null,
        })
        expect(await reattributeSyncedEmails()).toBeGreaterThanOrEqual(1)
        const [updated] = await findEmailEvidenceByIds({ ids: [evidence.id] })
        expect(updated!.mailbox_user_id).toBe(leslie.id)
        // Running it again changes nothing.
        expect(await reattributeSyncedEmails()).toBe(0)
    })
})
