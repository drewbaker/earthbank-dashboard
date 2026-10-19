// Covers downloading a fund as PDF: the summary, research with numbered sources, the team, open due
// diligence questions, the sources list and the last-page meeting checklist all make it into the file.
import { createApp, createRouter, eventHandler, toWebHandler } from 'h3'
import { extractText, getDocumentProxy } from 'unpdf'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'

vi.mock('nitropack/runtime', () => ({ defineRouteMeta: () => undefined }))
vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueEmail: async () => undefined,
    enqueueFundResearch: async () => 'queued',
    enqueuePublicInvestmentSync: async () => 'queued',
    enqueuePendingFundScreening: async () => 'queued',
}))

const { cleanupTestDatabase } = setupTestDatabase()
const now = new Date('2026-10-18T12:00:00Z')
let userId: string

beforeAll(async () => {
    const user = await createTestUser({ email: 'drew@theearthbank.org', name: 'Drew' })
    userId = user.id
})

afterAll(async () => {
    await cleanupTestDatabase()
})

describe('fund PDF', () => {
    it('downloads the profile with research, team, open diligence and numbered sources', async () => {
        const { addFund } = await import('#server/utils/funds/add-fund.ts')
        const { saveResearchResults } = await import('#server/database/fund-research.ts')
        const { updateFundManagerColumns } = await import('#server/database/fund-managers.ts')
        const { fund } = await addFund({
            name: 'Iungo Capital',
            websiteUrl: 'https://iungocapital.com',
            origin: 'seed',
            now,
        })
        await updateFundManagerColumns({ fundManagerId: fund.id, data: { notes: 'Ask about the Kenya pipeline.' } })
        const about = {
            url: 'https://iungocapital.com/about',
            title: 'About Iungo',
            kind: 'fund_website' as const,
            quote: 'Founded in 2020',
        }
        await saveResearchResults({
            fundManagerId: fund.id,
            researchRunId: null,
            findings: [
                {
                    field: 'year_established',
                    value: { year: 2020 },
                    valueKey: '{"year":2020}',
                    isList: false,
                    confidence: 0.9,
                    sources: [about],
                },
            ],
            people: [
                {
                    name: 'Léa Mwangi',
                    nameKey: 'lea mwangi',
                    title: 'Managing Partner',
                    isPrincipal: true,
                    linkedinUrl: null,
                    email: null,
                    bioSummary: null,
                    sources: [about],
                },
            ],
            affiliations: [],
            diligence: [],
            now,
        })

        const { findUser } = await import('#server/database/users.ts')
        const { default: downloadPdf } = await import('#server/routes/v1/funds/[id]/pdf.get.ts')
        const app = createApp()
        app.use(
            eventHandler(async event => {
                const user = await findUser({ userId })
                event.context.auth = {
                    user: { id: user!.id, email: user!.email, name: user!.name, avatar_url: null, role: 'admin' },
                    actor: { type: 'user', userId: user!.id },
                    sessionId: 'ses_test',
                }
            }),
        )
        app.use(createRouter().get('/v1/funds/:id/pdf', downloadPdf))
        const response = await toWebHandler(app)(new Request(`http://localhost/v1/funds/${fund.id}/pdf`))

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('application/pdf')
        expect(response.headers.get('content-disposition')).toContain('Iungo%20Capital%202026-10-18.pdf')
        const bytes = new Uint8Array(await response.arrayBuffer())
        expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
        const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true })
        expect(text).toContain('Iungo Capital')
        expect(text).toContain('Ask about the Kenya pipeline.')
        expect(text).toContain('2020')
        expect(text).toContain('Léa Mwangi')
        expect(text).toContain('Default rate')
        expect(text).toContain('https://iungocapital.com/about')
        // The last page is the meeting checklist: open diligence first, then other gaps.
        const checklist = text.slice(text.lastIndexOf('Questions to ask'))
        expect(checklist).toContain('Default rate')
        expect(checklist.indexOf('Time to close')).toBeLessThan(checklist.indexOf('Also missing'))
        expect(checklist).toContain('AUM')
        expect(checklist).not.toContain('Year established')
    })
})
