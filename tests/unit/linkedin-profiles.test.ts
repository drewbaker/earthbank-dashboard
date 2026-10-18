// Covers using LinkedIn profiles from a data provider: only a high-confidence match that lists the
// fund is used, the fund's own job is skipped, and jobs and schools become dated affiliations.
import { describe, expect, it } from 'vitest'
import { affiliationsFromProfile, isProfileOfFundPerson } from '#server/utils/funds/profiles.ts'
import type { PersonProfile } from '#server/utils/web/types.ts'

const profile: PersonProfile = {
    provider: 'datalegion',
    matchConfidence: 'high',
    employment: [
        {
            organization: 'Iungo Capital',
            website: 'iungocapital.com',
            title: 'Managing Partner',
            startDate: '2016-01',
            endDate: null,
        },
        {
            organization: 'BiD Network Foundation',
            website: 'bidnetwork.org',
            title: 'Co Director',
            startDate: '2015-03',
            endDate: '2015-12',
        },
    ],
    education: [
        { organization: 'KU Leuven', website: null, title: 'MSc Economics', startDate: '1995', endDate: '2000' },
    ],
}

describe('isProfileOfFundPerson', () => {
    it('needs a high-confidence match that lists the fund', () => {
        expect(isProfileOfFundPerson({ profile, fundNameKey: 'iungo capital', fundDomain: null })).toBe(true)
        expect(isProfileOfFundPerson({ profile, fundNameKey: 'other fund', fundDomain: 'iungocapital.com' })).toBe(true)
        expect(isProfileOfFundPerson({ profile, fundNameKey: 'other fund', fundDomain: 'other.com' })).toBe(false)
        expect(
            isProfileOfFundPerson({
                profile: { ...profile, matchConfidence: 'moderate' },
                fundNameKey: 'iungo capital',
                fundDomain: null,
            }),
        ).toBe(false)
    })
})

describe('affiliationsFromProfile', () => {
    it('turns other jobs and schools into affiliations sourced to the LinkedIn URL', () => {
        const affiliations = affiliationsFromProfile({
            profile,
            personName: 'Roeland Donckers',
            personNameKey: 'roeland donckers',
            linkedinUrl: 'https://www.linkedin.com/in/roelanddonckers',
            fundNameKey: 'iungo capital',
            fundDomain: 'iungocapital.com',
        })
        expect(affiliations).toHaveLength(2)
        expect(affiliations[0]).toMatchObject({
            relation: 'employment',
            organization: { name: 'BiD Network Foundation', kind: 'other' },
            title: 'Co Director',
            startYear: 2015,
            endYear: 2015,
            sources: [
                {
                    url: 'https://www.linkedin.com/in/roelanddonckers',
                    kind: 'linkedin',
                    quote: 'Co Director, BiD Network Foundation (2015-03–2015-12)',
                },
            ],
        })
        expect(affiliations[1]).toMatchObject({
            relation: 'education',
            organization: { name: 'KU Leuven', kind: 'school' },
            startYear: 1995,
        })
    })
})
