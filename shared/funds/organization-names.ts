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

// Legal forms dropped from the end of a displayed name ("Minlam Asset Management LLC"). Whole words
// like "Corporation" or "Company" are kept: they're usually part of the name.
const TRAILING_LEGAL_FORM =
    /(?:[\s,]+(?:L\.?L\.?C|Inc|Incorporated|Ltd|Limited|L\.?L\.?P|L\.?P|P\.?L\.?C|GmbH|AG|S\.?A\.?S|S\.?A\.?R\.?L|S\.?R\.?L|S\.?p\.?A|S\.?A\.?C|S\.?A\.?P\.?I\.?(?:\s+de\s+C\.?V)?|S\.?A|B\.?V|N\.?V|Pte|Pty|Corp|Co)\.?)+\s*$/i

// Short words kept lowercase inside a title-cased name, and abbreviations kept in capitals.
const LOWERCASE_WORDS = new Set([
    'a',
    'an',
    'and',
    'at',
    'de',
    'del',
    'des',
    'du',
    'for',
    'in',
    'la',
    'of',
    'on',
    'the',
    'to',
])
const UPPERCASE_WORDS = new Set([
    'cdfi',
    'sme',
    'smes',
    'msme',
    'usa',
    'us',
    'uk',
    'eu',
    'ii',
    'iii',
    'iv',
    'nyc',
    'dc',
    'ai',
])

/**
 * An organization's name as the team should see it: legal forms dropped from the end, and names
 * written in all capitals (as government lists often give them) in title case.
 *
 * "NORTHEAST ENTREPRENEUR FUND, INC." → "Northeast Entrepreneur Fund". Names that already use lower
 * case keep their capitalization. Unknown abbreviations in all-caps names come out title-cased; the AI
 * name check fixes those when it runs.
 *
 * @param input.name - The name as found.
 * @returns The tidied name (the original when tidying would leave nothing).
 */
export function tidyOrganizationName({ name }: { name: string }) {
    const trimmed = name.trim().replace(/\s+/g, ' ')
    const withoutLegalForm = trimmed.replace(TRAILING_LEGAL_FORM, '').replace(/[\s,]+$/, '') || trimmed
    if (/[a-z]/.test(withoutLegalForm) || !/[A-Z]{2}/.test(withoutLegalForm)) {
        return withoutLegalForm
    }
    return withoutLegalForm
        .toLowerCase()
        .split(' ')
        .map((word, index) => {
            if (UPPERCASE_WORDS.has(word.replace(/[^a-z]/g, ''))) {
                return word.toUpperCase()
            }
            if (index > 0 && LOWERCASE_WORDS.has(word)) {
                return word
            }
            // Capitalize each part of hyphenated or slashed words ("agro-processing" → "Agro-Processing").
            return word.replace(
                /(^|[-/(&])([a-z])/g,
                (_match, separator: string, letter: string) => separator + letter.toUpperCase(),
            )
        })
        .join(' ')
}

/**
 * Whether a name looks untidy: written in all capitals, or ending in a legal form.
 *
 * @param input.name - The name.
 * @returns True when tidyOrganizationName (or the AI name check) should look at it.
 */
export function isUntidyOrganizationName({ name }: { name: string }) {
    return tidyOrganizationName({ name }) !== name.trim()
}
