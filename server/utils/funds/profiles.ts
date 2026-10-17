import type { AffiliationToSave } from '#server/database/fund-research.ts'
import { listFundPeople, saveResearchResults } from '#server/database/fund-research.ts'
import type { PersonProfile, ProfileEntry, WebReader } from '#server/utils/web/types.ts'
import { canonicalLinkedinUrl, organizationNameKey, websiteDomain } from '#shared/funds/organization-names.ts'

/**
 * Add the work history and schools of a fund's people from their LinkedIn profiles (Data Legion through
 * Firecrawl), so the network graph and the spider have past employers to follow.
 *
 * Only people with a verified LinkedIn URL and no work history yet are looked up, principals first. A
 * profile is used only when the provider's match is high-confidence and the profile lists this fund
 * (by name or website), so another person's history is never attached.
 *
 * @param input.fundManagerId - The fund.
 * @param input.fundNameKey - Its normalized name.
 * @param input.fundDomain - Its website domain, if known.
 * @param input.reader - Firecrawl.
 * @param input.maxProfiles - Most lookups for this fund (each costs provider credits).
 * @param input.now - Current time.
 * @returns Organizations now linked (spider candidates), credits used, and profiles looked up and used.
 */
export async function addProfileWorkHistory({
    fundManagerId,
    fundNameKey,
    fundDomain,
    reader,
    maxProfiles,
    now,
}: {
    fundManagerId: string
    fundNameKey: string
    fundDomain: string | null
    reader: WebReader
    maxProfiles: number
    now: Date
}) {
    const people = (await listFundPeople({ fundManagerId }))
        .filter(person => person.linkedin_url && person.affiliations.length === 0)
        .slice(0, maxProfiles)
    const affiliations: AffiliationToSave[] = []
    let credits = 0
    let used = 0
    for (const person of people) {
        const linkedinUrl = canonicalLinkedinUrl({ url: person.linkedin_url! })
        const { profile, failure, credits: spent } = await reader.lookupPerson({ linkedinUrl })
        credits += spent
        if (!profile) {
            console.info('[research] no LinkedIn profile', person.id, failure?.code, failure?.message)
            continue
        }
        if (!isProfileOfFundPerson({ profile, fundNameKey, fundDomain })) {
            console.info(
                '[research] LinkedIn profile not used (low match or fund not listed)',
                person.id,
                profile.matchConfidence,
            )
            continue
        }
        used += 1
        affiliations.push(
            ...affiliationsFromProfile({
                profile,
                personName: person.name,
                personNameKey: person.name_key,
                linkedinUrl,
                fundNameKey,
                fundDomain,
            }),
        )
    }
    const saved =
        affiliations.length > 0
            ? await saveResearchResults({
                  fundManagerId,
                  researchRunId: null,
                  findings: [],
                  people: [],
                  affiliations,
                  diligence: [],
                  now,
              })
            : { organizationIds: [] as string[] }
    return { organizationIds: saved.organizationIds, credits, looked: people.length, used }
}

/**
 * Whether a looked-up profile is safe to use: a high-confidence match that lists this fund.
 *
 * @param input.profile - The provider's profile.
 * @param input.fundNameKey - The fund's normalized name.
 * @param input.fundDomain - The fund's website domain, if known.
 * @returns True when it can be used.
 */
export function isProfileOfFundPerson({
    profile,
    fundNameKey,
    fundDomain,
}: {
    profile: PersonProfile
    fundNameKey: string
    fundDomain: string | null
}) {
    return (
        profile.matchConfidence === 'high' &&
        profile.employment.some(entry => isFundEntry({ entry, fundNameKey, fundDomain }))
    )
}

/**
 * Turn a profile's other jobs and its schools into affiliations, sourced to the person's LinkedIn URL.
 *
 * @param input.profile - The provider's profile.
 * @param input.personName - The person's name (for the source label).
 * @param input.personNameKey - Their normalized name.
 * @param input.linkedinUrl - Their LinkedIn URL (the source link).
 * @param input.fundNameKey - The fund's normalized name (its own entries are skipped).
 * @param input.fundDomain - The fund's website domain, if known.
 * @returns Affiliations ready to store.
 */
export function affiliationsFromProfile({
    profile,
    personName,
    personNameKey,
    linkedinUrl,
    fundNameKey,
    fundDomain,
}: {
    profile: PersonProfile
    personName: string
    personNameKey: string
    linkedinUrl: string
    fundNameKey: string
    fundDomain: string | null
}): AffiliationToSave[] {
    const toAffiliation = (entry: ProfileEntry, relation: 'employment' | 'education'): AffiliationToSave => ({
        personNameKey,
        organization: {
            name: entry.organization,
            nameKey: organizationNameKey({ name: entry.organization }),
            // Employers are checked by the spider; schools never are.
            kind: relation === 'education' ? 'school' : 'other',
        },
        relation,
        title: entry.title,
        startYear: yearOf({ date: entry.startDate }),
        endYear: yearOf({ date: entry.endDate }),
        sources: [
            {
                url: linkedinUrl,
                title: `${personName} on LinkedIn (via ${profile.provider})`,
                kind: 'linkedin',
                quote: `${entry.title ? `${entry.title}, ` : ''}${entry.organization} (${entry.startDate ?? '?'}–${entry.endDate ?? 'present'})`.slice(
                    0,
                    300,
                ),
            },
        ],
    })
    return [
        ...profile.employment
            .filter(entry => !isFundEntry({ entry, fundNameKey, fundDomain }))
            .map(entry => toAffiliation(entry, 'employment')),
        ...profile.education.map(entry => toAffiliation(entry, 'education')),
    ].filter(affiliation => affiliation.organization.nameKey.length > 0)
}

/**
 * Whether a profile entry is the fund itself.
 *
 * @param input.entry - A job.
 * @param input.fundNameKey - The fund's normalized name.
 * @param input.fundDomain - The fund's website domain, if known.
 * @returns True when the entry is at this fund.
 */
function isFundEntry({
    entry,
    fundNameKey,
    fundDomain,
}: {
    entry: ProfileEntry
    fundNameKey: string
    fundDomain: string | null
}) {
    return (
        organizationNameKey({ name: entry.organization }) === fundNameKey ||
        (fundDomain !== null && websiteDomain({ url: entry.website }) === fundDomain)
    )
}

/**
 * The year of a YYYY or YYYY-MM date.
 *
 * @param input.date - The date, or null.
 * @returns The year, or null.
 */
function yearOf({ date }: { date: string | null }) {
    const year = Number(date?.slice(0, 4))
    return Number.isInteger(year) && year > 1900 ? year : null
}
