// Covers a fund's last activity: recent email with its domain in a connected Gmail and the team's
// "Still active" confirmation both count, so a fund the team is in touch with isn't "Possibly closed".
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueFundResearch: async () => 'queued',
    enqueuePublicInvestmentSync: async () => 'queued',
    enqueuePendingFundScreening: async () => 'queued',
    enqueueFundNameCheck: async () => 'queued',
}))

const { cleanupTestDatabase } = setupTestDatabase()
let leslieId: string
let steveId: string
let iungoId: string

beforeAll(async () => {
    leslieId = (await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })).id
    steveId = (await createTestUser({ email: 'steve@theearthbank.org', name: 'Steve' })).id
    const { addFund } = await import('#server/utils/funds/add-fund.ts')
    iungoId = (
        await addFund({
            name: 'Iungo Capital',
            websiteUrl: 'https://iungocapital.com',
            origin: 'manual',
            addedById: leslieId,
            now: new Date('2026-01-01T00:00:00Z'),
        })
    ).fund.id
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * A fake mailbox whose newest email with each domain was sent on the given date.
 *
 * @param input.newestByDomain - Domain → sent date.
 * @param input.queries - Collects the searches made.
 * @returns The mailbox reader.
 */
function fakeMailbox({ newestByDomain, queries }: { newestByDomain: Record<string, Date>; queries: string[] }) {
    return {
        async searchMessageIds({ query }: { query: string; limit: number }) {
            queries.push(query)
            const domain = Object.keys(newestByDomain).find(key => query.includes(`@${key}`))
            return domain ? [domain] : []
        },
        async getMessageHeaders({ gmailId }: { gmailId: string }) {
            return {
                gmailId,
                messageIdHeader: `<${gmailId}@mail>`,
                from: `someone@${gmailId}`,
                recipients: [],
                sentAt: newestByDomain[gmailId]!,
            }
        },
    }
}

describe('fund activity', () => {
    it("counts the newest email with the fund's domain across mailboxes, reading dates only", async () => {
        const { checkFundEmailActivity } = await import('#server/utils/funds/email-activity.ts')
        const { findFundManager } = await import('#server/database/fund-managers.ts')
        const queries: string[] = []
        const result = await checkFundEmailActivity({
            mailboxes: [
                {
                    userId: steveId,
                    reader: fakeMailbox({ newestByDomain: { 'iungocapital.com': new Date('2026-05-02') }, queries }),
                },
                {
                    userId: leslieId,
                    reader: fakeMailbox({ newestByDomain: { 'iungocapital.com': new Date('2026-10-03') }, queries }),
                },
            ],
        })
        expect(result).toEqual({ checked: 1, updated: 1 })
        expect(queries[0]).toBe('from:@iungocapital.com OR to:@iungocapital.com')
        const fund = await findFundManager({ fundManagerId: iungoId })
        expect(fund).toMatchObject({
            last_email_on: new Date('2026-10-03'),
            last_email_user_id: leslieId,
            last_activity_on: new Date('2026-10-03'),
            last_activity_source: 'email',
        })
        expect((fund!.fit_signals as Record<string, string>).recently_active).toBe('met')
    })

    it('skips a mailbox that fails and keeps checking the others', async () => {
        const { checkFundEmailActivity } = await import('#server/utils/funds/email-activity.ts')
        const failing = {
            async searchMessageIds(): Promise<string[]> {
                throw new Error('invalid_grant')
            },
            async getMessageHeaders(): Promise<never> {
                throw new Error('unreachable')
            },
        }
        const result = await checkFundEmailActivity({
            mailboxes: [
                { userId: steveId, reader: failing },
                {
                    userId: leslieId,
                    reader: fakeMailbox({
                        newestByDomain: { 'iungocapital.com': new Date('2026-10-10') },
                        queries: [],
                    }),
                },
            ],
        })
        expect(result).toEqual({ checked: 1, updated: 1 })
    })

    it('takes a team member confirming the fund is still active as activity that day', async () => {
        const { confirmFundActivity, findFundManager } = await import('#server/database/fund-managers.ts')
        const { refreshFundResearchValues } = await import('#server/utils/funds/refresh-values.ts')
        await confirmFundActivity({ fundManagerId: iungoId, userId: steveId, now: new Date('2026-10-20T12:00:00Z') })
        await refreshFundResearchValues({ fundManagerId: iungoId })
        expect(await findFundManager({ fundManagerId: iungoId })).toMatchObject({
            last_activity_on: new Date('2026-10-20T12:00:00Z'),
            last_activity_source: 'team',
            activity_confirmed_by_id: steveId,
        })
    })
})
