// Covers importing call notes into a fund: facts quoted from the note are stored and credited
// "Note from {author} on {time}", unquoted ones are dropped, diligence answers fill gaps but never
// replace a person's answer, and Google Doc links are read through Drive.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AiProvider, AiTool } from '#server/utils/ai/provider.ts'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueEmail: async () => undefined,
    enqueueFundResearch: async () => 'queued',
    enqueuePublicInvestmentSync: async () => 'queued',
    enqueuePendingFundScreening: async () => 'queued',
}))

const { cleanupTestDatabase } = setupTestDatabase()
const now = new Date('2026-10-18T22:04:00Z')
let leslie: { id: string; name: string }

const CALL_NOTES = `Call with Iungo, Oct 18
- Founded in 2019, HQ Nairobi.
- Default rate is about 2% across the book.
- They hedge FX through TCX for KES loans.
- Wanjiru Kamau (Managing Partner) led the call.`

beforeAll(async () => {
    const user = await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })
    leslie = { id: user.id, name: user.name }
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * A scripted model: reads the source URL from the prompt (it holds the note's id) and makes the calls.
 *
 * @param input.calls - Tool calls, with `SOURCE` standing in for the note's URL.
 * @returns The provider and the results each call got.
 */
function scriptedNoteReader({ calls }: { calls: { name: string; input: Record<string, unknown> }[] }) {
    const results: string[] = []
    const provider: AiProvider = {
        name: 'fake',
        model: 'fake-model',
        async runWithTools({ prompt, tools }: { instructions: string; prompt: string; tools: AiTool[] }) {
            const sourceUrl = prompt.match(/Source URL to cite for everything \(source_urls\): (\S+)/)![1]!
            for (const call of calls) {
                const tool = tools.find(candidate => candidate.name === call.name)!
                const input = JSON.parse(JSON.stringify(call.input).replaceAll('SOURCE', sourceUrl))
                results.push(await tool.run(tool.inputSchema.parse(input) as never))
            }
            return 'Done.'
        },
        async completeStructured() {
            throw new Error('not used')
        },
    }
    return { provider, results }
}

describe('importing a call note', () => {
    it('stores quoted facts credited to the note, drops unquoted ones and keeps people’s answers', async () => {
        const { addFund } = await import('#server/utils/funds/add-fund.ts')
        const { saveManualDiligenceAnswer } = await import('#server/database/fund-research.ts')
        const { importFundNote } = await import('#server/utils/funds/import-note.ts')
        const { fund } = await addFund({
            name: 'Iungo Capital',
            websiteUrl: 'https://iungocapital.com',
            origin: 'seed',
            now,
        })
        await saveManualDiligenceAnswer({
            fundManagerId: fund.id,
            question: 'fx_risk',
            answer: 'Lends in USD only (from the website).',
            userId: leslie.id,
        })
        const ai = scriptedNoteReader({
            calls: [
                {
                    name: 'record_finding',
                    input: {
                        finding: { field: 'year_established', value: { year: 2019 } },
                        source_urls: ['SOURCE'],
                        quote: 'Founded in 2019, HQ Nairobi.',
                        confidence: 0.9,
                    },
                },
                {
                    name: 'record_finding',
                    input: {
                        finding: { field: 'year_established', value: { year: 2015 } },
                        source_urls: ['SOURCE'],
                        quote: 'They started lending in 2015',
                        confidence: 0.9,
                    },
                },
                {
                    name: 'answer_diligence',
                    input: {
                        question: 'default_rate',
                        answer: 'About 2% across the book.',
                        source_urls: ['SOURCE'],
                        quote: 'Default rate is about 2% across the book.',
                        confidence: 0.9,
                    },
                },
                {
                    name: 'answer_diligence',
                    input: {
                        question: 'fx_risk',
                        answer: 'Hedges FX through TCX for KES loans.',
                        source_urls: ['SOURCE'],
                        quote: 'They hedge FX through TCX for KES loans.',
                        confidence: 0.9,
                    },
                },
                {
                    name: 'record_person',
                    input: {
                        name: 'Wanjiru Kamau',
                        title: 'Managing Partner',
                        is_principal: true,
                        linkedin_url: null,
                        email: null,
                        bio_summary: null,
                        source_urls: ['SOURCE'],
                        quote: 'Wanjiru Kamau (Managing Partner) led the call.',
                    },
                },
            ],
        })

        const note = await importFundNote({
            fundManagerId: fund.id,
            fundName: fund.name,
            author: leslie,
            text: CALL_NOTES,
            docUrl: null,
            timeZone: 'America/Los_Angeles',
            ai: ai.provider,
            now,
        })

        expect(ai.results[1]).toContain('Not recorded')
        expect(note).toMatchObject({
            status: 'done',
            title: 'Note from Leslie on Oct 18, 2026, 3:04 PM',
            findings_added: 1,
            people_added: 1,
            diligence_answered: 1,
            dropped: 1,
        })
        expect(note.kept_existing).toEqual([{ question: 'fx_risk', answer: 'Hedges FX through TCX for KES loans.' }])

        const { loadFundDetail } = await import('#server/utils/funds/fund-detail.ts')
        const detail = await loadFundDetail({ fundManagerId: fund.id })
        const founded = detail.findings.find(finding => finding.field === 'year_established')!
        expect(founded.value).toEqual({ year: 2019 })
        expect(founded.sources).toEqual([
            expect.objectContaining({
                kind: 'team_note',
                title: 'Note from Leslie on Oct 18, 2026, 3:04 PM',
                url: expect.stringContaining(`/funds/${fund.id}?tab=import&note=${note.id}`),
                quote: 'Founded in 2019, HQ Nairobi.',
            }),
        ])
        expect(detail.year_established).toBe(2019)
        expect(detail.people.map(person => person.name)).toEqual(['Wanjiru Kamau'])
        const defaultRate = detail.diligence.find(item => item.question === 'default_rate')!
        expect(defaultRate).toMatchObject({
            answer: 'About 2% across the book.',
            source: 'manual',
            answered_by: expect.objectContaining({ name: 'Leslie' }),
            note: expect.objectContaining({ id: note.id, title: 'Note from Leslie on Oct 18, 2026, 3:04 PM' }),
        })
        expect(detail.diligence.find(item => item.question === 'fx_risk')).toMatchObject({
            answer: 'Lends in USD only (from the website).',
            note: null,
        })
        expect(detail.imported_notes[0]).toMatchObject({ id: note.id, origin: 'pasted', findings_added: 1 })
    })

    it('refuses text that looks like a personal document', async () => {
        const { addFund } = await import('#server/utils/funds/add-fund.ts')
        const { importFundNote } = await import('#server/utils/funds/import-note.ts')
        const { fund } = await addFund({
            name: 'Spring Bank',
            websiteUrl: 'https://springbank.example',
            origin: 'seed',
            now,
        })
        const ai = scriptedNoteReader({ calls: [] })
        await expect(
            importFundNote({
                fundManagerId: fund.id,
                fundName: fund.name,
                author: leslie,
                text: 'Passport number: X1234567. Date of birth: 1980-01-01. Social Security Number 123-45-6789',
                docUrl: null,
                timeZone: 'UTC',
                ai: ai.provider,
                now,
            }),
        ).rejects.toMatchObject({ code: 'sensitive_document' })
    })
})

describe('reading a Google Doc', () => {
    it('exports the doc through Drive, and refuses links that are not Google Docs', async () => {
        const { readGoogleDocText } = await import('#server/utils/funds/import-note.ts')
        const drive = {
            getItem: async ({ itemId }: { itemId: string }) => ({
                id: itemId,
                name: 'Iungo call',
                kind: 'file' as const,
                file: {
                    id: itemId,
                    name: 'Iungo call',
                    mimeType: 'application/vnd.google-apps.document',
                    modifiedAt: now,
                    webViewLink: null,
                    sizeBytes: null,
                },
            }),
            listFiles: async () => [],
            exportFile: async () => new TextEncoder().encode(CALL_NOTES),
            downloadFile: async () => new Uint8Array(),
        }
        const text = await readGoogleDocText({
            docUrl: 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit',
            userId: leslie.id,
            drive,
        })
        expect(text).toContain('Default rate is about 2%')
        await expect(
            readGoogleDocText({ docUrl: 'https://example.com/notes', userId: leslie.id, drive }),
        ).rejects.toMatchObject({ code: 'invalid_doc_url' })
    })
})
