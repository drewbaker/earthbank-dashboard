// Covers how fund names are tidied for display: legal forms dropped, all-caps names title-cased, and
// AI-proposed names accepted only when they name the same organization.
import { describe, expect, it } from 'vitest'
import { acceptedDisplayName } from '#server/utils/funds/fund-names.ts'
import { tidyOrganizationName } from '#shared/funds/organization-names.ts'

describe('tidyOrganizationName', () => {
    it('drops legal forms from the end and title-cases all-caps names', () => {
        expect(tidyOrganizationName({ name: 'Minlam Asset Managment LLC' })).toBe('Minlam Asset Managment')
        expect(tidyOrganizationName({ name: 'NORTHEAST ENTREPRENEUR FUND, INC.' })).toBe('Northeast Entrepreneur Fund')
        expect(tidyOrganizationName({ name: 'Prestamype S.A.C.' })).toBe('Prestamype')
        expect(tidyOrganizationName({ name: 'Acme S.A.P.I. de C.V.' })).toBe('Acme')
        expect(tidyOrganizationName({ name: 'Triodos Investment Management B.V.' })).toBe(
            'Triodos Investment Management',
        )
        expect(tidyOrganizationName({ name: 'FUND FOR THE NORTH OF ENGLAND' })).toBe('Fund for the North of England')
        expect(tidyOrganizationName({ name: 'CDFI FRIENDLY AMERICA' })).toBe('CDFI Friendly America')
    })

    it('keeps names that already use lower case, and words that are part of the name', () => {
        expect(tidyOrganizationName({ name: 'AHL Ventures' })).toBe('AHL Ventures')
        expect(tidyOrganizationName({ name: 'Brattleboro Development Credit Corporation' })).toBe(
            'Brattleboro Development Credit Corporation',
        )
        // Nothing would be left, so the name stays.
        expect(tidyOrganizationName({ name: 'Co.' })).toBe('Co.')
    })
})

describe('acceptedDisplayName', () => {
    it("takes the AI's name when it only changes capitalization or legal forms", () => {
        expect(acceptedDisplayName({ original: 'BII IMPACT FUND, LLC', proposed: 'BII Impact Fund' })).toBe(
            'BII Impact Fund',
        )
    })

    it('falls back to tidying the original when the AI renamed the organization', () => {
        expect(acceptedDisplayName({ original: 'NEBRASKA ENTERPRISE FUND', proposed: 'Nebraska Fund' })).toBe(
            'Nebraska Enterprise Fund',
        )
        expect(acceptedDisplayName({ original: 'NEBRASKA ENTERPRISE FUND', proposed: null })).toBe(
            'Nebraska Enterprise Fund',
        )
    })
})
