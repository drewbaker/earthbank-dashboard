// Covers grant geographic focus: valid codes, names, and which countries a mix of regions and
// countries covers (Global is reported separately, not painted on every country).
import { describe, expect, it } from 'vitest'
import { countriesInFocus, geoFocusLabel, geoFocusOptions, isGeoFocusCode } from '#shared/utils/geo-focus.ts'
import { Opportunity, UpdateOpportunityRequest } from '#shared/schemas/index.ts'

describe('geographic focus', () => {
    it('knows countries, regions and Global, and nothing else', () => {
        expect(isGeoFocusCode({ code: 'KE' })).toBe(true)
        expect(isGeoFocusCode({ code: 'region:eastern_africa' })).toBe(true)
        expect(isGeoFocusCode({ code: 'global' })).toBe(true)
        expect(isGeoFocusCode({ code: 'XX' })).toBe(false)
        expect(isGeoFocusCode({ code: 'region:atlantis' })).toBe(false)
    })

    it('names codes for people', () => {
        expect(geoFocusLabel({ code: 'KE' })).toBe('Kenya')
        expect(geoFocusLabel({ code: 'region:latin_america' })).toBe('Latin America & Caribbean')
        expect(geoFocusLabel({ code: 'global' })).toBe('Global')
    })

    it('expands regions into countries and leaves Global out of the map', () => {
        const countries = countriesInFocus({ codes: ['region:eastern_africa', 'BR', 'global'] })
        expect(countries.has('KE')).toBe(true)
        expect(countries.has('TZ')).toBe(true)
        expect(countries.has('BR')).toBe(true)
        expect(countries.has('US')).toBe(false)
        expect(countriesInFocus({ codes: ['global'] }).size).toBe(0)
    })

    it('offers Global first, then regions, then countries by name', () => {
        const options = geoFocusOptions()
        expect(options[0]).toMatchObject({ code: 'global', group: 'Global' })
        expect(options[1]!.group).toBe('Regions')
        const countries = options.filter(option => option.group === 'Countries').map(option => option.label)
        expect(countries).toEqual([...countries].sort((first, second) => first.localeCompare(second)))
    })

    it('rejects unknown codes when an opportunity is saved', () => {
        expect(UpdateOpportunityRequest.safeParse({ focus_areas: ['KE', 'region:south_asia'] }).success).toBe(true)
        expect(UpdateOpportunityRequest.safeParse({ focus_areas: ['Kenya'] }).success).toBe(false)
        expect(Opportunity.shape.focus_areas).toBeDefined()
    })
})
