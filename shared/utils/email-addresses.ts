import { FREE_MAIL_DOMAINS } from '#shared/constants/free-mail-domains.ts'

/**
 * Normalize an email address for matching and storage.
 *
 * @param input.email - Raw address, possibly with whitespace or a display name like `Jane <jane@x.org>`.
 * @returns The lowercased bare address, or null when it doesn't look like an email.
 */
export function normalizeEmailAddress({ email }: { email: string }) {
    const bracketed = email.match(/<([^>]+)>/)
    const candidate = (bracketed?.[1] ?? email).trim().toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null
}

/**
 * The domain of an email address.
 *
 * @param input.email - A normalized email address.
 * @returns The domain part, lowercased.
 */
export function emailDomain({ email }: { email: string }) {
    return email.split('@').at(-1)!.toLowerCase()
}

/**
 * Whether a domain belongs to a personal mailbox provider (gmail.com, outlook.com, …).
 *
 * @param input.domain - A lowercased domain.
 * @returns True for free-mail domains.
 */
export function isFreeMailDomain({ domain }: { domain: string }) {
    return FREE_MAIL_DOMAINS.has(domain.toLowerCase())
}

/**
 * The organization domains implied by a set of email addresses, skipping free-mail providers.
 *
 * @param input.emails - Normalized email addresses.
 * @returns Unique domains in first-seen order.
 */
export function organizationDomains({ emails }: { emails: string[] }) {
    const domains = emails.map(email => emailDomain({ email })).filter(domain => !isFreeMailDomain({ domain }))
    return [...new Set(domains)]
}

/**
 * Normalize a domain typed by a person (`@IKEAfoundation.org`, `https://www.x.org/`).
 *
 * @param input.domain - Raw domain text.
 * @returns The bare lowercased domain, or null when it isn't one.
 */
export function normalizeDomain({ domain }: { domain: string }) {
    const bare = domain
        .trim()
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : null
}
