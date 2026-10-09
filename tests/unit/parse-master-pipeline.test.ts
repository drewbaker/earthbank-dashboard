// Covers turning the "Master Pipeline" sheet into funders: columns, statuses, contacts, dates, duplicates.
import { describe, expect, it } from 'vitest'
import { latestDate, parseContacts, parseMasterPipeline } from '#server/utils/pipeline-import/parse-master-pipeline.ts'

const HEADER = [
    'Organization',
    'Key Contact(s)',
    'Email(s)',
    'Geo Focus',
    'Tiered Priority',
    'Potential Size',
    'Status',
    'Design / Grant $',
    'Potential Follow-On $',
    'EB 3-Pager',
    'Last Contact',
    'Notes — Momentum & Next Step',
]

const ROWS = [
    ['RESOLVE / EARTH BANK — FUNDER MASTER PIPELINE'],
    ['Last updated Aug 6, 2026'],
    [],
    HEADER,
    [
        'Bezos Earth Fund',
        'Paul Bodnar, Sarah LaMonaca',
        'pbodnar@bezosearthfund.org, slamonaca@bezosearthfund.org',
        'EM',
        'T1',
        'Above $10M',
        'Advanced',
        500000,
        50000000,
        'Y',
        'Jun 2, 2026 (met Jun 10)',
        '$500k design grant possible. NEXT: send materials, propose grant.',
    ],
    [
        'Hewlett Foundation',
        'J. Stephenson',
        'jstephenson@hewlett.org',
        'Global',
        'T1',
        'Design Grant Only',
        'Active',
        1000000,
        null,
        '—',
        'No email trail found',
        'NEXT: initial outreach.',
    ],
    [
        'Three Cairns',
        'Daniel Hullah, Taylor Ray',
        'dhullah@threecairnsgroup.com; tray@threecairnsgroup.com',
        'EM',
        'T2',
        'Design Grant Only',
        'Active',
        null,
        5000000,
        'Y',
        'Jun 18, 2026 (email)',
        'Signalling grant. NEXT: schedule next call.',
    ],
    [
        'Howden Foundation',
        'Paula Pagniez / CEO, Claire Harbron',
        'claire.harbron@howdenfoundation.com',
        'Global',
        'T4',
        'TBD',
        'Dead',
        null,
        null,
        '—',
        'Jul 5, 2026 (email)',
        'No longer pursuing.',
    ],
    [
        'Moore Foundation',
        '—',
        '—',
        'US',
        'T4',
        'TBD',
        'No Contact',
        null,
        null,
        '—',
        'No relationship',
        'NEXT: identify warm intro.',
    ],
    [
        'Hewlett Foundation',
        'J. Stephenson',
        'jstephenson@hewlett.org',
        'Global',
        'T4',
        'TBD',
        'No Contact',
        null,
        null,
        '—',
        'No email trail found',
        'Priority target.',
    ],
    ['PIPELINE TOTAL', null, null, null, null, null, null, 1500000, 55000000],
    [],
    ['MacArthur'],
]

describe('parseMasterPipeline', () => {
    const { funders, warnings } = parseMasterPipeline({ rows: ROWS })
    const byName = new Map(funders.map(funder => [funder.name, funder]))

    it('reads every organization once, including prospects listed under the total', () => {
        expect(funders.map(funder => funder.name)).toEqual([
            'Bezos Earth Fund',
            'Hewlett Foundation',
            'Three Cairns',
            'Howden Foundation',
            'Moore Foundation',
            'MacArthur',
        ])
    })

    it('merges duplicate rows, keeping the higher-priority one', () => {
        const hewlett = byName.get('Hewlett Foundation')!
        expect(hewlett.tier).toBe('t1')
        expect(hewlett.relationshipStatus).toBe('active')
        expect(hewlett.sheetRows).toEqual([6, 10])
        expect(hewlett.contacts).toHaveLength(1)
        expect(warnings.some(warning => warning.includes('Hewlett'))).toBe(true)
    })

    it('creates design-grant and lending-capital opportunities from the two $ columns', () => {
        expect(byName.get('Bezos Earth Fund')!.opportunities).toEqual([
            {
                goalType: 'design_grant',
                stage: 'due_diligence',
                amountCents: 50_000_000,
                nextStep: 'send materials, propose grant.',
            },
            { goalType: 'lending_capital', stage: 'identified', amountCents: 5_000_000_000, nextStep: null },
        ])
    })

    it('adds an amount-less design grant for "Design Grant Only" funders in conversation', () => {
        expect(byName.get('Three Cairns')!.opportunities[0]).toMatchObject({
            goalType: 'design_grant',
            amountCents: null,
        })
    })

    it('maps statuses and creates no opportunities without a relationship', () => {
        expect(byName.get('Howden Foundation')!.relationshipStatus).toBe('dead')
        expect(byName.get('Moore Foundation')!.relationshipStatus).toBe('no_contact')
        expect(byName.get('Moore Foundation')!.opportunities).toEqual([])
    })

    it('records materials sent, last contact and the full notes', () => {
        const bezos = byName.get('Bezos Earth Fund')!
        expect(bezos.materialsSent).toBe(true)
        expect(bezos.lastContactAt).toBe('2026-06-10')
        expect(bezos.notes).toContain('$500k design grant possible')
    })
})

describe('parseContacts', () => {
    it('pairs names and emails by name, not just position', () => {
        const { contacts } = parseContacts({
            namesText: 'Jeremy Hockenstein, Harry Davies, Shannie',
            emailsText: 'harry@lifund.org; jeremy@lifund.org; shannie@lifund.org',
        })
        expect(contacts.map(contact => [contact.name, contact.email])).toEqual([
            ['Jeremy Hockenstein', 'jeremy@lifund.org'],
            ['Harry Davies', 'harry@lifund.org'],
            ['Shannie', 'shannie@lifund.org'],
        ])
    })

    it('expands "(+ A, B)" into extra people and keeps other parentheticals as notes', () => {
        const { contacts } = parseContacts({
            namesText: 'Rodney O. (+ Loreen, Emmanuel Kalia); Jeff Rowbottom (Head of Credit)',
            emailsText: 'Rodney@fsdafrica.org; Loreen@fsdafrica.org; emmanuel.kalia@fsdafrica.org',
        })
        expect(contacts.map(contact => [contact.name, contact.email, contact.notes])).toEqual([
            ['Rodney O.', 'rodney@fsdafrica.org', null],
            ['Loreen', 'loreen@fsdafrica.org', null],
            ['Emmanuel Kalia', 'emmanuel.kalia@fsdafrica.org', null],
            ['Jeff Rowbottom', null, 'Head of Credit'],
        ])
    })

    it('splits "Name / Title" and names extra emails after the address', () => {
        const { contacts } = parseContacts({
            namesText: 'Paula Pagniez / CEO',
            emailsText: 'claire.harbron@howden.com',
        })
        expect(contacts[0]).toMatchObject({ name: 'Paula Pagniez', title: 'CEO' })
        expect(contacts[0]!.email).toBe('claire.harbron@howden.com')
    })

    it('turns a parenthetical-only cell into a funder note', () => {
        const { contacts, funderNote } = parseContacts({
            namesText: '(Leslie reaching out)',
            emailsText: 'Not found in inbox — verify manually',
        })
        expect(contacts).toEqual([])
        expect(funderNote).toBe('Leslie reaching out')
    })
})

describe('latestDate', () => {
    it.each([
        ['Jun 29, 2026', '2026-06-29'],
        ['Jun 2, 2026 (met Jun 10)', '2026-06-10'],
        ['Jun 24, 2026 (in-person); Jul 8, 2026 (email)', '2026-07-08'],
        ['Jun 12, 2026 (email) / meeting Jul 20', '2026-07-20'],
        ['Apr 2026 (in-person, Nairobi)', '2026-04-01'],
        ['No contact logged', null],
        [null, null],
    ])('%s → %s', (text, expected) => {
        expect(latestDate({ text })).toBe(expected)
    })
})
