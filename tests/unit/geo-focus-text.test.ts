// Covers reading the spreadsheet's free-text "Geo Focus" column into focus codes.
import { describe, expect, it } from 'vitest'
import { focusCodesFromText } from '#shared/utils/geo-focus.ts'

describe('focusCodesFromText', () => {
    it.each([
        ['Global', ['global']],
        ['EM', ['region:emerging_markets']],
        ['Africa', ['region:africa']],
        ['US', ['US']],
        ['Europe', ['region:europe']],
        ['Asia', ['region:asia']],
        ['Africa, India', ['region:africa', 'IN']],
        ['Brazil, Indonesia, Kenya, Uganda, Ethiopia, India', ['BR', 'ID', 'KE', 'UG', 'ET', 'IN']],
        ['US, Global', ['US', 'global']],
        ['East Africa and Latin America', ['region:eastern_africa', 'region:latin_america']],
    ])('reads %s', (text, codes) => {
        expect(focusCodesFromText({ text })).toEqual({ codes, unmatched: [] })
    })

    it('reports parts it does not recognise', () => {
        expect(focusCodesFromText({ text: 'Kenya, the Moon' })).toEqual({ codes: ['KE'], unmatched: ['the Moon'] })
    })

    it('treats empty text as no focus', () => {
        expect(focusCodesFromText({ text: null })).toEqual({ codes: [], unmatched: [] })
    })
})
