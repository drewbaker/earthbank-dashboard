// Covers the one-time import of the old Airtable fund board: new funds are added and queued for
// research, funds already on the list only get what they're missing, and nothing is added twice.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

const queuedResearch = vi.hoisted(() => [] as { fundManagerId: string; isPriority: boolean }[])
vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueFundResearch: async (input: { fundManagerId: string; isPriority: boolean }) => {
        queuedResearch.push(input)
        return 'queued'
    },
    enqueuePublicInvestmentSync: async () => 'queued',
    enqueuePendingFundScreening: async () => 'queued',
    enqueueFundNameCheck: async () => 'queued',
}))

const { cleanupTestDatabase } = setupTestDatabase()
const now = new Date('2026-10-21T00:00:00Z')
let userId: string

const RECORDS = [
    {
        id: 'rec1',
        fields: {
            'Organization Name': 'Sunrise Agro Lending LLC',
            Website: 'https://sunriseagro.example',
            'Pipeline Stage': 'In Diligence',
            Archetype: 'Worked Example',
            Region: 'Sub-Saharan Africa',
            'Geographic Focus': 'Kenya (Nairobi HQ)',
            'Fund Thesis': 'Working capital for agro-processors.',
            'Contact Name': 'Jane Doe',
            'Contact Position': 'CEO',
            'Fund Materials': '[{"type":"Deck","label":"Deck","url":"https://drive.google.com/file/d/abc/view"}]',
        },
    },
    {
        id: 'rec2',
        fields: {
            'Organization Name': 'Mara Energy Partners (Fund II)',
            Website: 'https://maraenergy.example',
            'Pipeline Stage': 'Sourced',
            Archetype: 'Adjacent Market Specialist',
            Region: 'Latin America',
            'Fund Thesis': 'Distributed solar debt.',
        },
    },
    { id: 'rec3', fields: { 'Organization Name': 'Kept Archived Fund', 'Pipeline Stage': 'Sourced' } },
    { id: 'rec4', fields: { Website: 'https://no-name.example' } },
]

beforeAll(async () => {
    userId = (await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })).id
    const { addFund } = await import('#server/utils/funds/add-fund.ts')
    const { updateFundManagerColumns } = await import('#server/database/fund-managers.ts')
    // A fund the team already has, with its own notes and stage.
    const { fund: mara } = await addFund({
        name: 'Mara Energy',
        websiteUrl: null,
        origin: 'manual',
        addedById: userId,
        now,
    })
    await updateFundManagerColumns({ fundManagerId: mara.id, data: { notes: 'Met at SOCAP.', stage: 'shortlisted' } })
    const { fund: archived } = await addFund({
        name: 'Kept Archived Fund',
        websiteUrl: null,
        origin: 'manual',
        addedById: userId,
        now,
    })
    await updateFundManagerColumns({ fundManagerId: archived.id, data: { archived_at: now } })
})

afterAll(async () => {
    await cleanupTestDatabase()
})

describe('importBoardFunds', () => {
    it('adds new funds, fills in existing ones without overwriting, and leaves team-archived funds alone', async () => {
        const { importBoardFunds, readBoardFunds } = await import('#server/utils/funds/import-board.ts')
        const { listFundManagers } = await import('#server/database/fund-managers.ts')
        queuedResearch.length = 0
        const funds = readBoardFunds({ records: RECORDS })
        expect(funds).toHaveLength(3)

        const result = await importBoardFunds({ funds, importedById: userId, now })
        expect(result).toMatchObject({ added: 1, updated: 1, left_archived: 1, skipped: 0 })

        const all = await listFundManagers({ includeArchived: true, limit: 100 })
        const sunrise = all.find(fund => fund.name === 'Sunrise Agro Lending')!
        expect(sunrise).toMatchObject({
            origin: 'board_import',
            approval_status: 'approved',
            stage: 'in_diligence',
            fit_tags: ['worked_example'],
            team_focus_areas: ['KE'],
            website_domain: 'sunriseagro.example',
        })
        expect(sunrise.notes).toContain('Thesis: Working capital for agro-processors.')
        expect(sunrise.notes).toContain('Contact: Jane Doe, CEO')
        expect(sunrise.notes).toContain('Fund materials: Deck <https://drive.google.com/file/d/abc/view>')
        expect(queuedResearch).toEqual([{ fundManagerId: sunrise.id, isPriority: true }])

        // Matched by its name without the parenthetical; the team's stage and notes are kept.
        const mara = all.find(fund => fund.name === 'Mara Energy')!
        expect(mara.stage).toBe('shortlisted')
        expect(mara.notes).toMatch(
            /^Met at SOCAP\.\n\nFrom the old fund board \(Airtable\):\nThesis: Distributed solar debt\./,
        )
        expect(mara.website_domain).toBe('maraenergy.example')
        expect(all.filter(fund => fund.name.startsWith('Mara'))).toHaveLength(1)

        expect(all.find(fund => fund.name === 'Kept Archived Fund')?.archived_at).toEqual(now)
    })

    it('changes nothing when the same file is imported again', async () => {
        const { importBoardFunds, readBoardFunds } = await import('#server/utils/funds/import-board.ts')
        const result = await importBoardFunds({
            funds: readBoardFunds({ records: RECORDS }),
            importedById: userId,
            now,
        })
        expect(result).toMatchObject({ added: 0, updated: 0, unchanged: 2, left_archived: 1 })
    })
})
