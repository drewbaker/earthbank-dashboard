import { listSyncedEmailParties, setEmailEvidenceOwner } from '#server/database/email-evidence.ts'
import { listUsers } from '#server/database/users.ts'
import { config } from '#server/utils/config.ts'
import { normalizeEmailAddress } from '#shared/utils/email-addresses.ts'

export type TeamMemberAddress = { id: string; email: string }

/**
 * Which team member an email belongs to, so the Activity page shows it as theirs.
 *
 * The same email lands in every inbox it was sent to, and whichever inbox syncs first reads it. That
 * made an email Leslie sent with Steve on CC show up as Steve's. Instead, the sender owns it; when the
 * sender isn't on the team, the first team member it was addressed to does (To before Cc, in the order
 * the recipients were listed). Addresses on Earth Bank's other domains count as the same person
 * (leslie@resolvefund.org is leslie@theearthbank.org).
 *
 * @param input.from - Sender address.
 * @param input.recipients - To addresses, then Cc addresses, in header order.
 * @param input.teamMembers - Active users and their primary addresses.
 * @param input.fallbackUserId - Whose inbox it was read from, used when no team member is on it.
 * @param input.workspaceDomain - Earth Bank's primary domain.
 * @param input.internalDomains - All of Earth Bank's domains.
 * @returns The owning user's id, or the fallback.
 */
export function emailOwnerUserId({
    from,
    recipients,
    teamMembers,
    fallbackUserId,
    workspaceDomain,
    internalDomains,
}: {
    from: string
    recipients: string[]
    teamMembers: TeamMemberAddress[]
    fallbackUserId: string | null
    workspaceDomain: string
    internalDomains: string[]
}) {
    const userIdsByEmail = new Map(teamMembers.map(member => [member.email.toLowerCase(), member.id]))
    for (const address of [from, ...recipients]) {
        const primary = primaryAddress({ address, workspaceDomain, internalDomains })
        const userId = primary ? userIdsByEmail.get(primary) : undefined
        if (userId) {
            return userId
        }
    }
    return fallbackUserId
}

/**
 * The owner of an email among the current team (see `emailOwnerUserId`).
 *
 * @param input.from - Sender address.
 * @param input.recipients - To addresses, then Cc addresses.
 * @param input.fallbackUserId - Whose inbox it was read from.
 * @returns The owning user's id, or the fallback.
 */
export async function findEmailOwnerUserId({
    from,
    recipients,
    fallbackUserId,
}: {
    from: string
    recipients: string[]
    fallbackUserId: string | null
}) {
    return emailOwnerUserId({
        from,
        recipients,
        teamMembers: await listTeamMemberAddresses(),
        fallbackUserId,
        workspaceDomain: config.googleWorkspaceDomain,
        internalDomains: config.internalEmailDomains,
    })
}

/**
 * Every active user's address.
 *
 * @returns `{ id, email }` per active user.
 */
export async function listTeamMemberAddresses() {
    const users = await listUsers()
    return users.filter(user => !user.deactivated_at).map(user => ({ id: user.id, email: user.email }))
}

/**
 * An address in its primary form: Earth Bank aliases map to the Workspace domain, others stay as they are.
 *
 * @param input.address - Any address.
 * @param input.workspaceDomain - Earth Bank's primary domain.
 * @param input.internalDomains - All of Earth Bank's domains.
 * @returns The lowercased primary address, or null when it isn't an address.
 */
function primaryAddress({
    address,
    workspaceDomain,
    internalDomains,
}: {
    address: string
    workspaceDomain: string
    internalDomains: string[]
}) {
    const normalized = normalizeEmailAddress({ email: address })
    if (!normalized) {
        return null
    }
    const [local, domain] = normalized.split('@')
    return domain && internalDomains.includes(domain) ? `${local}@${workspaceDomain}` : normalized
}

/**
 * Re-credit emails read before ownership followed the sender, so old Activity cards show the right
 * person too. Recipients were stored To first, then Cc, so the same rule applies. Safe to run on
 * every boot: rows already credited correctly are left alone.
 *
 * @returns How many emails changed owner.
 */
export async function reattributeSyncedEmails() {
    const [emails, teamMembers] = await Promise.all([listSyncedEmailParties(), listTeamMemberAddresses()])
    const idsByNewOwner = new Map<string, string[]>()
    for (const email of emails) {
        const ownerUserId = emailOwnerUserId({
            from: email.from_address,
            recipients: Array.isArray(email.to_addresses) ? (email.to_addresses as string[]) : [],
            teamMembers,
            fallbackUserId: email.mailbox_user_id,
            workspaceDomain: config.googleWorkspaceDomain,
            internalDomains: config.internalEmailDomains,
        })
        if (ownerUserId && ownerUserId !== email.mailbox_user_id) {
            idsByNewOwner.set(ownerUserId, [...(idsByNewOwner.get(ownerUserId) ?? []), email.id])
        }
    }
    let changed = 0
    for (const [mailboxUserId, emailEvidenceIds] of idsByNewOwner) {
        changed += await setEmailEvidenceOwner({ emailEvidenceIds, mailboxUserId })
    }
    return changed
}
