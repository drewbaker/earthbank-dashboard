import { funderNameKey } from '#shared/utils/funder-names.ts'

// Legal forms and filler that don't tell two organizations apart ("Iungo Capital Ltd" = "Iungo Capital").
const NAME_NOISE_WORDS = new Set([
    'the',
    'ltd',
    'limited',
    'llc',
    'llp',
    'lp',
    'inc',
    'incorporated',
    'corp',
    'corporation',
    'co',
    'plc',
    'sa',
    'sas',
    'sarl',
    'srl',
    'spa',
    'ag',
    'gmbh',
    'bv',
    'nv',
    'pte',
    'pty',
    'sac',
    'sapi',
    'de',
    'cv',
])

/**
 * The key two organization names share when they mean the same organization.
 *
 * Builds on the funder name key and also drops legal forms ("Ltd", "S.A.C.", "GmbH") and a leading "the".
 *
 * @param input.name - Organization name as found.
 * @returns The normalized key, e.g. "iungo capital".
 */
export function organizationNameKey({ name }: { name: string }) {
    const words = funderNameKey({ name: name.replace(/\./g, '') }).split(' ')
    const kept = words.filter(word => !NAME_NOISE_WORDS.has(word))
    return (kept.length > 0 ? kept : words).join(' ')
}

/**
 * A LinkedIn profile or company URL in its standard form (www.linkedin.com, no query or trailing
 * slash). LinkedIn serves the same page on country subdomains (ug.linkedin.com), which data providers
 * don't recognize.
 *
 * @param input.url - A LinkedIn URL.
 * @returns The standard URL, or the input unchanged when it isn't a LinkedIn profile or company URL.
 */
export function canonicalLinkedinUrl({ url }: { url: string }) {
    const match = /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(in|company|school)\/([^/?#]+)/i.exec(url.trim())
    return match ? `https://www.linkedin.com/${match[1]!.toLowerCase()}/${match[2]}` : url
}

/**
 * The bare host of a website address, used to tell organizations apart.
 *
 * @param input.url - A URL or host, with or without a scheme.
 * @returns Lowercased host without "www.", or null when it isn't a usable address.
 */
export function websiteDomain({ url }: { url: string | null | undefined }) {
    if (!url) {
        return null
    }
    try {
        const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
        return host.includes('.') ? host : null
    } catch {
        return null
    }
}
