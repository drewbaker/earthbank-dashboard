// Covers how web addresses are shown: no protocol, no "www.", no trailing slash.
import { describe, expect, it } from 'vitest'
import { displayUrl } from '#shared/utils/display-url.ts'

describe('displayUrl', () => {
    it('drops the protocol, www and trailing slash', () => {
        expect(displayUrl({ url: 'https://www.enduringplanet.com/' })).toBe('enduringplanet.com')
        expect(displayUrl({ url: 'http://iungocapital.com/about/' })).toBe('iungocapital.com/about')
    })

    it('drops a known prefix such as linkedin.com/', () => {
        expect(
            displayUrl({ url: 'https://www.linkedin.com/company/enduring-planet/', dropPrefix: 'linkedin.com/' }),
        ).toBe('company/enduring-planet')
    })
})
