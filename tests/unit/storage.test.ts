// Covers storage-key safety: keys can't escape the storage root and filenames are cleaned.
import { describe, expect, it } from 'vitest'
import { safeFilename, storagePath } from '#server/utils/storage.ts'

describe('storagePath', () => {
    it('resolves keys inside DATA_DIR/files', () => {
        expect(storagePath({ key: 'tasks/tsk_1/att_1/report.pdf' })).toMatch(/files\/tasks\/tsk_1\/att_1\/report\.pdf$/)
    })

    it.each(['../app.db', 'tasks/../../db/app.db', '/etc/passwd'])('refuses %s', key => {
        expect(() => storagePath({ key })).toThrow('escapes the storage root')
    })
})

describe('safeFilename', () => {
    it.each([
        ['Q3 report (final).pdf', 'Q3-report-final-.pdf'],
        ['../../secret.txt', 'secret.txt'],
        ['C:\\Users\\drew\\deck.pptx', 'deck.pptx'],
        ['..', 'file'],
        ['', 'file'],
    ])('%s → %s', (input, expected) => {
        expect(safeFilename({ filename: input })).toBe(expected)
    })
})
