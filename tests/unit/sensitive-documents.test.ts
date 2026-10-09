// Covers which Drive documents are skipped as sensitive: by file name (IDs, tax forms, bank details)
// and by content (SSNs, passport lines, card and account numbers), without catching business documents.
import { describe, expect, it } from 'vitest'
import { sensitiveReasonFromName, sensitiveReasonFromText } from '#server/utils/knowledge/sensitive.ts'

describe('sensitiveReasonFromName', () => {
    it.each([
        'Drew passport scan.pdf',
        "Leslie Driver's License.jpg",
        'driving_licence_front.png',
        'Social Security card.pdf',
        'SSN.pdf',
        'Birth Certificate.pdf',
        'Steve ID.pdf',
        'photo-id.png',
        'ID card back.jpg',
        'US visa copy.pdf',
        'Green Card.pdf',
        'I-9 form.pdf',
        'W-9 Earth Bank.pdf',
        '2025 W2.pdf',
        '1099-NEC.pdf',
        'Tax Return 2024.pdf',
        'Bank statement Sept.pdf',
        'Voided check.pdf',
        'Payroll summary Q3.xlsx',
        'Pay stub.pdf',
        'Medical records.pdf',
        'Background check - candidate.pdf',
    ])('flags %s', name => {
        expect(sensitiveReasonFromName({ name })).not.toBeNull()
    })

    it.each([
        'Earth Bank 3-pager.docx',
        'Financial model v12.xlsx',
        'Visa Foundation proposal.docx',
        'Grant ID list.xlsx',
        'Ideas for the lending fund.docx',
        'Investor deck.pptx',
        'Board minutes - Sept.pdf',
    ])('does not flag %s', name => {
        expect(sensitiveReasonFromName({ name })).toBeNull()
    })
})

describe('sensitiveReasonFromText', () => {
    it('finds personal identifiers and account numbers', () => {
        expect(sensitiveReasonFromText({ text: 'Employee SSN: 123-45-6789' })).toMatch(/Social Security/)
        expect(sensitiveReasonFromText({ text: 'P<USABAKER<<DREW<<<<<<<<<<<<<<<<<<<<<<<<<<<' })).toMatch(/passport/)
        expect(sensitiveReasonFromText({ text: 'Routing number: 021000021' })).toMatch(/bank account/)
        expect(sensitiveReasonFromText({ text: 'Card 4111 1111 1111 1111 exp 12/29' })).toMatch(/card number/)
    })

    it('leaves business documents alone', () => {
        const text = [
            'Earth Bank lends to regenerative farmers. Phone (415) 555-0134.',
            'Lending capital target: $250,000,000 over 10 years, 4.5% blended rate.',
            'Order ref 1234567890123 (fails the card check).',
        ].join('\n')
        expect(sensitiveReasonFromText({ text })).toBeNull()
    })
})
