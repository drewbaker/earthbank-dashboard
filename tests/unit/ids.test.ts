// Covers id generation: prefixes, length, and that ids sort by creation time.
import { describe, expect, it } from 'vitest'
import { ID_PREFIXES, newId } from '#server/utils/ids.ts'

describe('newId', () => {
    it('uses the prefix for the kind and 26 base32 characters', () => {
        const id = newId({ kind: 'funder' })
        expect(id).toMatch(/^fnd_[0-9a-hjkmnp-tv-z]{26}$/)
    })

    it('sorts by creation time', () => {
        const earlier = newId({ kind: 'task', now: Date.UTC(2026, 0, 1) })
        const later = newId({ kind: 'task', now: Date.UTC(2026, 0, 2) })
        expect([later, earlier].sort()).toEqual([earlier, later])
    })

    it('has unique prefixes', () => {
        const prefixes = Object.values(ID_PREFIXES)
        expect(new Set(prefixes).size).toBe(prefixes.length)
    })
})
