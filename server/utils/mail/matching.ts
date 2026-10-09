import { emailDomain, isFreeMailDomain } from '#shared/utils/email-addresses.ts'

export type FunderMatchIndex = {
    byContactEmail: Map<string, string>
    byDomain: Map<string, string>
}

/**
 * Build lookups from contact emails and funder domains to funder ids.
 *
 * @param input.funders - Active funders with their contact emails and domains.
 * @returns The match index.
 */
export function buildFunderMatchIndex({
    funders,
}: {
    funders: { id: string; contactEmails: string[]; emailDomains: string[] }[]
}): FunderMatchIndex {
    const byContactEmail = new Map<string, string>()
    const byDomain = new Map<string, string>()
    for (const funder of funders) {
        for (const email of funder.contactEmails) {
            byContactEmail.set(email.toLowerCase(), funder.id)
        }
        for (const domain of funder.emailDomains) {
            if (!isFreeMailDomain({ domain })) {
                byDomain.set(domain.toLowerCase(), funder.id)
            }
        }
    }
    return { byContactEmail, byDomain }
}

/**
 * The funder an email belongs to: the sender's funder first, then the first recipient's. Exact
 * contact addresses win over domains, and free-mail domains never match by domain.
 *
 * @param input.index - The match index.
 * @param input.from - Sender address.
 * @param input.recipients - To and Cc addresses.
 * @returns The funder id, or null.
 */
export function matchFunder({
    index,
    from,
    recipients,
}: {
    index: FunderMatchIndex
    from: string
    recipients: string[]
}) {
    for (const address of [from, ...recipients]) {
        const exact = index.byContactEmail.get(address)
        if (exact) {
            return exact
        }
        const byDomain = index.byDomain.get(emailDomain({ email: address }))
        if (byDomain) {
            return byDomain
        }
    }
    return null
}

/**
 * Gmail search queries covering every funder address and domain, split so each stays well under
 * Gmail's query length limit. Each query is `{from:x to:x cc:x …} after:<unix>` (braces mean OR).
 *
 * @param input.contactEmails - Exact addresses (including free-mail ones).
 * @param input.domains - Funder domains (never free-mail).
 * @param input.after - Only mail after this time.
 * @param input.maxLength - Maximum characters per query.
 * @returns Search queries.
 */
export function buildFunderMailQueries({
    contactEmails,
    domains,
    after,
    maxLength = 1400,
}: {
    contactEmails: string[]
    domains: string[]
    after: Date
    maxLength?: number
}) {
    const domainSet = new Set(
        domains.map(domain => domain.toLowerCase()).filter(domain => !isFreeMailDomain({ domain })),
    )
    // An address already covered by its domain doesn't need its own terms.
    const identifiers = [
        ...domainSet,
        ...new Set(
            contactEmails.map(email => email.toLowerCase()).filter(email => !domainSet.has(emailDomain({ email }))),
        ),
    ]
    const suffix = ` after:${Math.floor(after.getTime() / 1000)}`
    const queries: string[] = []
    let terms: string[] = []
    for (const identifier of identifiers) {
        const identifierTerms = [`from:${identifier}`, `to:${identifier}`, `cc:${identifier}`]
        if (terms.length > 0 && `{${[...terms, ...identifierTerms].join(' ')}}${suffix}`.length > maxLength) {
            queries.push(`{${terms.join(' ')}}${suffix}`)
            terms = []
        }
        terms.push(...identifierTerms)
    }
    if (terms.length > 0) {
        queries.push(`{${terms.join(' ')}}${suffix}`)
    }
    return queries
}
