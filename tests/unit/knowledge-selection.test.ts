// Covers which Drive text the AI reads: everything when it fits, otherwise pinned documents plus the
// passages that best match the email; and how files become text.
import { describe, expect, it } from 'vitest'
import { buildDocx, buildPptx } from '#root/tests/helpers/office-files.ts'
import { parseDriveItemId } from '#server/utils/knowledge/drive.ts'
import { contentPlan, extractText, spreadsheetText } from '#server/utils/knowledge/extract.ts'
import { chunkText, scoreChunks, selectKnowledge } from '#server/utils/knowledge/select.ts'

/**
 * A document for selection tests.
 *
 * @param input.id - Id (also sets the stable order).
 * @param input.name - Name.
 * @param input.text - Text.
 * @param input.isPinned - Pinned.
 * @returns The document.
 */
function document({
    id,
    name,
    text,
    isPinned = false,
}: {
    id: string
    name: string
    text: string
    isPinned?: boolean
}) {
    return { id, name, text, is_pinned: isPinned, web_view_link: `https://drive.google.com/${id}` }
}

describe('selectKnowledge', () => {
    it('includes every document whole when they fit, pinned first then in id order', () => {
        const selection = selectKnowledge({
            documents: [
                document({ id: 'kdc_2', name: 'Model', text: 'Lending model figures.' }),
                document({ id: 'kdc_1', name: 'Deck', text: 'Pitch deck.' }),
                document({ id: 'kdc_3', name: 'Three pager', text: 'What Earth Bank is.', isPinned: true }),
            ],
            query: 'anything',
            budgetCharacters: 10_000,
        })
        expect(selection.isComplete).toBe(true)
        expect(selection.documents.map(item => item.name)).toEqual(['Three pager', 'Deck', 'Model'])
        expect(selection.reference).toContain('<document name="Three pager">\nWhat Earth Bank is.\n</document>')
    })

    it('keeps pinned documents whole and picks matching passages from the rest when over budget', () => {
        const filler = 'General background about soil and farming practice. '.repeat(40)
        const selection = selectKnowledge({
            documents: [
                document({ id: 'kdc_1', name: 'Explainer', text: 'Earth Bank in three pages.', isPinned: true }),
                document({
                    id: 'kdc_2',
                    name: 'Financial model',
                    text: `${filler}\n\nThe design grant budget is $480,000 over 18 months.\n\n${filler}`,
                }),
                document({ id: 'kdc_3', name: 'Team bios', text: filler }),
            ],
            query: 'What is the design grant budget?',
            budgetCharacters: 2000,
        })
        expect(selection.isComplete).toBe(false)
        expect(selection.reference).toContain('Earth Bank in three pages.')
        expect(selection.reference).toContain('$480,000')
        expect(selection.reference).toContain('excerpts="true"')
        expect(selection.reference.length).toBeLessThan(2400)
        expect(selection.documents.map(item => item.name)).toContain('Financial model')
    })

    it('returns nothing when there are no usable documents', () => {
        const selection = selectKnowledge({
            documents: [document({ id: 'kdc_1', name: 'Empty', text: '  ' })],
            query: 'x',
        })
        expect(selection.reference).toBe('')
        expect(selection.documents).toEqual([])
    })
})

describe('chunkText and scoreChunks', () => {
    it('splits long text into passages of bounded size', () => {
        const chunks = chunkText({
            text: Array.from({ length: 30 }, (_, index) => `Paragraph ${index} ${'x'.repeat(200)}`).join('\n\n'),
        })
        expect(chunks.length).toBeGreaterThan(3)
        expect(Math.max(...chunks.map(chunk => chunk.length))).toBeLessThanOrEqual(1500)
    })

    it('scores passages with the query words higher and ignores filler words', () => {
        const scores = scoreChunks({
            chunks: ['The lending capital pipeline and terms.', 'Office lunch menu for the week.'],
            query: 'Please share the lending terms, thanks',
        })
        expect(scores[0]).toBeGreaterThan(0)
        expect(scores[1]).toBe(0)
    })
})

describe('Drive file handling', () => {
    it('exports Google formats and downloads readable uploads', () => {
        expect(contentPlan({ mimeType: 'application/vnd.google-apps.document' })).toEqual({
            action: 'export',
            exportMimeType: 'text/plain',
        })
        expect(contentPlan({ mimeType: 'application/vnd.google-apps.spreadsheet' })).toMatchObject({
            exportMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        expect(contentPlan({ mimeType: 'application/pdf' })).toEqual({
            action: 'download',
            mimeType: 'application/pdf',
        })
        expect(
            contentPlan({ mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        ).toMatchObject({ action: 'download' })
        expect(contentPlan({ mimeType: 'application/msword' })).toBeNull()
        expect(contentPlan({ mimeType: 'image/png' })).toBeNull()
    })

    it('reads Word documents', async () => {
        const text = await extractText({
            data: buildDocx({ paragraphs: ['Earth Bank three-pager', 'We lend to farmers &amp; land stewards.'] }),
            contentMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
        expect(text).toBe('Earth Bank three-pager\n\nWe lend to farmers & land stewards.')
    })

    it('reads PowerPoint slides in order with their speaker notes', async () => {
        const slides: { paragraphs: string[]; notes?: string[] }[] = Array.from({ length: 11 }, (_, index) => ({
            paragraphs: [`Slide text ${index + 1}`],
        }))
        slides[0] = { paragraphs: ['Earth Bank', 'Capital for regenerative land'], notes: ['Open with the ask'] }
        const text = await extractText({
            data: buildPptx({ slides }),
            contentMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        })
        expect(text).toMatch(
            /^## Slide 1\nEarth Bank\nCapital for regenerative land\nNotes: Open with the ask\n\n## Slide 2\n/,
        )
        // Slide 10 comes after slide 9, not after slide 1.
        expect(text.indexOf('Slide text 10')).toBeGreaterThan(text.indexOf('Slide text 9'))
    })

    it('turns every spreadsheet tab into text, skipping empty rows', () => {
        const text = spreadsheetText({
            sheets: [
                {
                    sheet: 'Assumptions',
                    data: [
                        ['Loan size', 250000],
                        [null, null],
                        ['Rate', 0.065],
                        ['Start', new Date('2027-01-01T00:00:00Z')],
                    ],
                },
                { sheet: 'Empty', data: [[null]] },
            ],
        })
        expect(text).toBe('## Assumptions\nLoan size | 250000\nRate | 0.065\nStart | 2027-01-01')
    })

    it('reads folder and file ids from links and bare ids, and rejects anything else', () => {
        expect(
            parseDriveItemId({ value: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing' }),
        ).toBe('1AbCdEfGhIjKlMnOp')
        expect(parseDriveItemId({ value: 'https://drive.google.com/drive/u/0/folders/0B_xyz-1234567890' })).toBe(
            '0B_xyz-1234567890',
        )
        expect(parseDriveItemId({ value: ' 1AbCdEfGhIjKlMnOp ' })).toBe('1AbCdEfGhIjKlMnOp')
        expect(parseDriveItemId({ value: 'https://docs.google.com/document/d/1DocIdAbcdefgh/edit?tab=t.0' })).toBe(
            '1DocIdAbcdefgh',
        )
        expect(parseDriveItemId({ value: 'https://docs.google.com/spreadsheets/d/1SheetIdAbcdef/edit#gid=0' })).toBe(
            '1SheetIdAbcdef',
        )
        expect(parseDriveItemId({ value: 'https://drive.google.com/file/d/1PdfIdAbcdefgh/view?usp=drive_link' })).toBe(
            '1PdfIdAbcdefgh',
        )
        expect(parseDriveItemId({ value: 'https://drive.google.com/open?id=1OpenIdAbcdefg' })).toBe('1OpenIdAbcdefg')
        expect(parseDriveItemId({ value: "x' or name contains 'a" })).toBeNull()
        expect(parseDriveItemId({ value: 'short' })).toBeNull()
    })
})
