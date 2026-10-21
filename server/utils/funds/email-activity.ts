import { listFundsForEmailActivity, storeFundLastEmail } from '#server/database/fund-managers.ts'
import { config } from '#server/utils/config.ts'
import { refreshFundResearchValues } from '#server/utils/funds/refresh-values.ts'
import type { MailboxReader } from '#server/utils/mail/sync.ts'
import { FREE_MAIL_DOMAINS } from '#shared/constants/free-mail-domains.ts'

/** A connected Gmail to check, and whose it is. */
export type ActivityMailbox = { userId: string; reader: Pick<MailboxReader, 'searchMessageIds' | 'getMessageHeaders'> }

/**
 * Find the newest email to or from each approved fund's website domain in the team's connected Gmail
 * accounts, and count it as the fund's activity (so a fund the team is corresponding with isn't shown
 * as "Possibly closed").
 *
 * Only Gmail's search and the newest matching message's headers are read, for its date: never the
 * email's content, and nothing goes to the AI. Free-mail and Earth Bank's own domains are skipped.
 *
 * @param input.mailboxes - Connected mailboxes; one that fails (e.g. revoked access) is skipped.
 * @returns How many funds' email dates were updated.
 */
export async function checkFundEmailActivity({ mailboxes }: { mailboxes: ActivityMailbox[] }) {
    const ownDomains = new Set([config.googleWorkspaceDomain, ...config.internalEmailDomains])
    const funds = (await listFundsForEmailActivity()).filter(
        fund => !FREE_MAIL_DOMAINS.has(fund.website_domain!) && !ownDomains.has(fund.website_domain!),
    )
    let updated = 0
    const unreadable = new Set<ActivityMailbox>()
    for (const fund of funds) {
        let newest: { sentAt: Date; userId: string } | null = null
        for (const mailbox of mailboxes) {
            if (unreadable.has(mailbox)) {
                continue
            }
            let sentAt: Date | null = null
            try {
                sentAt = await newestEmailWithDomain({ reader: mailbox.reader, domain: fund.website_domain! })
            } catch (error) {
                // Revoked access or a Gmail outage: skip this mailbox for the rest of the run.
                console.error('[funds] email activity check failed', error instanceof Error ? error.message : error)
                unreadable.add(mailbox)
            }
            if (sentAt && (!newest || sentAt > newest.sentAt)) {
                newest = { sentAt, userId: mailbox.userId }
            }
        }
        if (newest && (!fund.last_email_on || newest.sentAt > fund.last_email_on)) {
            await storeFundLastEmail({ fundManagerId: fund.id, lastEmailOn: newest.sentAt, userId: newest.userId })
            await refreshFundResearchValues({ fundManagerId: fund.id })
            updated += 1
        }
    }
    return { checked: funds.length, updated }
}

/**
 * The date of the newest email to or from a domain in one mailbox.
 *
 * @param input.reader - The mailbox.
 * @param input.domain - The fund's website domain.
 * @returns When it was sent, or null when there's none.
 */
async function newestEmailWithDomain({
    reader,
    domain,
}: {
    reader: Pick<MailboxReader, 'searchMessageIds' | 'getMessageHeaders'>
    domain: string
}) {
    const [gmailId] = await reader.searchMessageIds({ query: `from:@${domain} OR to:@${domain}`, limit: 1 })
    return gmailId ? (await reader.getMessageHeaders({ gmailId })).sentAt : null
}
