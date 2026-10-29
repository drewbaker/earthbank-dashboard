// Covers files on funders and funds: a fund's PDF is read into its research (facts quoted from the
// file, credited to it), a funder's file updates its asks with changes linked to the file, personal
// documents aren't read, and files attached to emails sent to the dashboard are screened (signature
// images, invites and personal files left alone), filed once with the right funder or fund, including
// on the pass over past emails.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AiProvider, AiTool, StructuredResult } from '#server/utils/ai/provider.ts'
import { fakeAi } from '#root/tests/helpers/fake-ai.ts'
import { createTestUser } from '#root/tests/helpers/factories.ts'
import { setupTestDatabase } from '#root/tests/helpers/test-database.ts'
import type { ReceivedEmail } from '#server/utils/mail/inbound.ts'

const queuedReads = vi.hoisted(() => [] as string[])
const sentEmails = vi.hoisted(() => [] as { to: string; subject: string; text: string }[])
vi.mock('#server/utils/jobs/enqueue.ts', () => ({
    enqueueEmail: async (email: { to: string; subject: string; text: string }) => {
        sentEmails.push(email)
    },
    enqueueAttachmentRead: async ({ attachmentId }: { attachmentId: string }) => {
        queuedReads.push(attachmentId)
        return 'queued'
    },
    enqueueFunderBackfill: async () => undefined,
    enqueueFundResearch: async () => 'queued',
    enqueuePublicInvestmentSync: async () => 'queued',
    enqueuePendingFundScreening: async () => 'queued',
    enqueueFundNameCheck: async () => 'queued',
}))

process.env.INBOUND_EMAIL_DOMAIN = 'mail.theearthbank.org'
process.env.DASHBOARD_EMAIL_ADDRESS = 'dashboard@theearthbank.org'

const PASSING_AUTH = 'mx.google.com; dkim=pass header.i=@theearthbank.org; dmarc=pass header.from=theearthbank.org'
const now = new Date('2026-10-29T15:00:00Z')

const { cleanupTestDatabase } = setupTestDatabase()
let leslieId: string
let funderId: string
let opportunityId: string
let fundId: string
let factSheetPdf: Uint8Array

const FACT_SHEET_LINES = [
    'Iungo Capital fact sheet',
    'Founded in 2019 and headquartered in Nairobi.',
    'Default rate below 2% since inception.',
]

beforeAll(async () => {
    const { ensureDefaultGoals } = await import('#server/database/goals.ts')
    const { createFunderWithDetails, loadFunderDetail } = await import('#server/utils/funders.ts')
    const { addFund } = await import('#server/utils/funds/add-fund.ts')
    const { renderPdf } = await import('#server/utils/pdf.ts')
    await ensureDefaultGoals()
    leslieId = (await createTestUser({ email: 'leslie@theearthbank.org', name: 'Leslie' })).id
    funderId = await createFunderWithDetails({
        name: 'UBS Optimus Foundation',
        relationshipStatus: 'active',
        contacts: [{ name: 'Tom Hall', email: 'tom.hall@ubs.com' }],
        opportunity: { goalType: 'design_grant', stage: 'proposal', amountCents: 50_000_000 },
    })
    opportunityId = (await loadFunderDetail({ funderId })).opportunities[0]!.id
    fundId = (await addFund({ name: 'Iungo Capital', websiteUrl: 'https://iungocapital.com', origin: 'seed', now }))
        .fund.id
    factSheetPdf = await renderPdf({ document: { content: FACT_SHEET_LINES.map(text => ({ text })) } })
})

afterAll(async () => {
    await cleanupTestDatabase()
})

/**
 * A model that reads a fund file the way the note reader does: it cites the source URL from the prompt
 * and makes the given tool calls.
 *
 * @param input.calls - Tool calls, with `SOURCE` standing in for the file's source URL.
 * @returns The provider.
 */
function scriptedFileReader({ calls }: { calls: { name: string; input: Record<string, unknown> }[] }): AiProvider {
    return {
        name: 'fake',
        model: 'fake-model',
        async runWithTools({ prompt, tools }: { instructions: string; prompt: string; tools: AiTool[] }) {
            const sourceUrl = prompt.match(/Source URL to cite for everything \(source_urls\): (\S+)/)![1]!
            for (const call of calls) {
                const tool = tools.find(candidate => candidate.name === call.name)!
                const input = JSON.parse(JSON.stringify(call.input).replaceAll('SOURCE', sourceUrl))
                await tool.run(tool.inputSchema.parse(input) as never)
            }
            return 'Done.'
        },
        async completeStructured() {
            return { status: 'refused', output: null, model: 'fake-model' } as StructuredResult<never>
        },
    }
}

/**
 * An email received at the dashboard address.
 *
 * @param overrides - Fields to change.
 * @returns The received email.
 */
function received(overrides: Partial<ReceivedEmail>): ReceivedEmail {
    return {
        id: `rcv_${Math.random()}`,
        from: 'Leslie <leslie@theearthbank.org>',
        to: ['dashboard@theearthbank.org'],
        receivedFor: ['dashboard@mail.theearthbank.org'],
        subject: 'Fwd: Award letter',
        text: '---------- Forwarded message ---------\nFrom: Tom Hall <tom.hall@ubs.com>\nDate: Mon, Oct 26, 2026 at 9:00 AM\nSubject: Award letter\nTo: <leslie@theearthbank.org>\n\nPlease find the award letter attached.',
        html: null,
        headers: { 'Authentication-Results': PASSING_AUTH },
        createdAt: '2026-10-26T14:00:00Z',
        attachments: [],
        ...overrides,
    }
}

const AWARD_LETTER = 'UBS Optimus Foundation award letter. We are pleased to award Earth Bank $500,000.'

describe('files on a fund', () => {
    it('reads a PDF into the research, credited to the file', async () => {
        const { storeAttachment } = await import('#server/utils/attachments/files.ts')
        const { readAttachment } = await import('#server/utils/attachments/read.ts')
        const { db } = await import('#server/utils/db.ts')
        const attachment = await storeAttachment({
            target: { kind: 'fund', fundManagerId: fundId },
            data: factSheetPdf,
            filename: 'Iungo fact sheet.pdf',
            contentType: 'application/pdf',
            uploadedById: leslieId,
        })
        expect(attachment.read_status).toBe('queued')
        expect(queuedReads).toContain(attachment.id)

        const outcome = await readAttachment({
            attachmentId: attachment.id,
            ai: scriptedFileReader({
                calls: [
                    {
                        name: 'record_finding',
                        input: {
                            finding: { field: 'year_established', value: { year: 2019 } },
                            source_urls: ['SOURCE'],
                            quote: 'Founded in 2019 and headquartered in Nairobi.',
                            confidence: 0.9,
                        },
                    },
                    {
                        name: 'answer_diligence',
                        input: {
                            question: 'default_rate',
                            answer: 'Below 2% since inception.',
                            source_urls: ['SOURCE'],
                            quote: 'Default rate below 2% since inception.',
                            confidence: 0.9,
                        },
                    },
                ],
            }),
            now,
        })
        expect(outcome).toMatchObject({ status: 'done', counts: { facts: 1, diligence: 1 } })

        const row = await db().attachment.findUniqueOrThrow({ where: { id: attachment.id } })
        expect(row.read_status).toBe('done')
        expect(row.read_summary).toBe('Added 1 fact and 1 diligence answer to the research.')
        const note = await db().fundNote.findFirstOrThrow({ where: { attachment_id: attachment.id } })
        expect(note).toMatchObject({
            origin: 'attachment',
            title: expect.stringMatching(/^Iungo fact sheet\.pdf from Leslie on /),
        })
        const finding = await db().fundFinding.findFirstOrThrow({
            where: { fund_manager_id: fundId, field: 'year_established' },
            include: { sources: { include: { source: true } } },
        })
        expect(finding.sources[0]!.source).toMatchObject({
            kind: 'team_note',
            url: `http://localhost:3000/funds/${fundId}?tab=files&file=${attachment.id}`,
        })
    })

    it('does not read a personal document', async () => {
        const { storeAttachment } = await import('#server/utils/attachments/files.ts')
        const { readAttachment } = await import('#server/utils/attachments/read.ts')
        const attachment = await storeAttachment({
            target: { kind: 'fund', fundManagerId: fundId },
            data: new TextEncoder().encode('Passport number: X1234567'),
            filename: 'passport scan.txt',
            contentType: 'text/plain',
            uploadedById: leslieId,
        })
        const outcome = await readAttachment({
            attachmentId: attachment.id,
            ai: scriptedFileReader({ calls: [] }),
            now,
        })
        expect(outcome).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/passport/) })
    })

    it('keeps an image but marks it not read', async () => {
        const { storeAttachment } = await import('#server/utils/attachments/files.ts')
        const attachment = await storeAttachment({
            target: { kind: 'fund', fundManagerId: fundId },
            data: new Uint8Array([137, 80, 78, 71]),
            filename: 'team.png',
            contentType: 'image/png',
            uploadedById: leslieId,
        })
        expect(attachment.read_status).toBe('skipped')
        expect(queuedReads).not.toContain(attachment.id)
    })
})

describe('files on a funder', () => {
    it('updates the ask from an award letter, linking each change to the file', async () => {
        const { storeAttachment } = await import('#server/utils/attachments/files.ts')
        const { readAttachment } = await import('#server/utils/attachments/read.ts')
        const { db } = await import('#server/utils/db.ts')
        const attachment = await storeAttachment({
            target: { kind: 'funder', funderId },
            data: new TextEncoder().encode(AWARD_LETTER),
            filename: 'award-letter.txt',
            contentType: 'text/plain',
            uploadedById: leslieId,
        })
        const { provider, prompts } = fakeAi({
            answers: [
                {
                    is_relevant: true,
                    summary: 'Award letter: UBS awards Earth Bank $500,000.',
                    reason: 'The letter awards the grant.',
                    opportunity_id: opportunityId,
                    opportunity_updates: [
                        {
                            opportunity_id: opportunityId,
                            stage: 'committed',
                            amount_usd: 500_000,
                            expected_decision_on: null,
                            expected_receipt_on: null,
                            next_step: 'Sign and return the award letter',
                            confidence: 0.95,
                            reason: 'The letter says the grant is awarded.',
                        },
                    ],
                    new_contacts: [
                        { name: 'Anna Berg', email: 'anna.berg@ubs.com', title: 'Grants manager' },
                        { name: 'Someone Else', email: 'someone@otherfoundation.org', title: null },
                    ],
                },
            ],
        })
        const outcome = await readAttachment({ attachmentId: attachment.id, ai: provider, now })
        expect(prompts[0]).toContain(AWARD_LETTER)
        expect(outcome).toMatchObject({ status: 'done', counts: { contacts: 1 } })

        const opportunity = await db().opportunity.findUniqueOrThrow({ where: { id: opportunityId } })
        expect(opportunity.stage).toBe('committed')
        const stageChange = await db().changeEvent.findFirstOrThrow({
            where: { entity_id: opportunityId, field: 'stage' },
        })
        expect(stageChange).toMatchObject({ source: 'ai_document', status: 'applied', attachment_id: attachment.id })
        const row = await db().attachment.findUniqueOrThrow({ where: { id: attachment.id } })
        expect(row).toMatchObject({ read_status: 'done', opportunity_id: opportunityId })
        const contacts = await db().contact.findMany({ where: { funder_id: funderId } })
        expect(contacts.map(contact => contact.email).sort()).toEqual(['anna.berg@ubs.com', 'tom.hall@ubs.com'])
    })
})

describe('files emailed to the dashboard', () => {
    const files: Record<string, Uint8Array> = {
        att_letter: new TextEncoder().encode(AWARD_LETTER),
        att_logo: new Uint8Array(4096),
        att_invite: new TextEncoder().encode('BEGIN:VCALENDAR'),
        att_private: new TextEncoder().encode('Dear Leslie, about the birthday party on Saturday… '.repeat(10)),
    }
    const attachments = [
        {
            id: 'att_letter',
            filename: 'Award letter.txt',
            contentType: 'text/plain',
            size: 900,
            contentDisposition: 'attachment',
        },
        {
            id: 'att_logo',
            filename: 'image001.png',
            contentType: 'image/png',
            size: 4096,
            contentDisposition: 'inline',
        },
        {
            id: 'att_invite',
            filename: 'invite.ics',
            contentType: 'text/calendar',
            size: 900,
            contentDisposition: 'attachment',
        },
        {
            id: 'att_private',
            filename: 'party.txt',
            contentType: 'text/plain',
            size: 900,
            contentDisposition: 'attachment',
        },
    ]
    const download = async ({ attachmentId }: { attachmentId: string }) => files[attachmentId]!

    it('files a forward’s documents with its funder, once, leaving signatures, invites and personal files alone', async () => {
        const { processInboundEmail } = await import('#server/utils/mail/inbound.ts')
        const { db } = await import('#server/utils/db.ts')
        const email = received({ id: 'rcv_forward_files', attachments })
        const { provider } = fakeAi({
            answers: [
                // The screen: the letter is a business document, the party note is personal.
                { kind: 'business_document', summary: 'Award letter from UBS Optimus Foundation.' },
                { kind: 'personal', summary: 'A personal note.' },
                // The forward's own classification.
                {
                    is_relevant: true,
                    is_sensitive: false,
                    summary: 'Tom sent the award letter.',
                    reason: 'Award letter attached.',
                    confidence: 0.9,
                    is_personal_exchange: true,
                    last_contact_on: '2026-10-26',
                    relationship_status: null,
                    opportunity_updates: [],
                    new_contacts: [],
                },
            ],
        })
        const result = await processInboundEmail({
            receivedEmailId: email.id,
            ai: provider,
            today: '2026-10-29',
            fetchReceivedEmail: async () => email,
            downloadAttachment: download,
        })
        expect(result).toMatchObject({ kind: 'forward', filed: 1 })
        const filed = await db().attachment.findMany({ where: { received_email_id: email.id } })
        expect(filed).toHaveLength(1)
        expect(filed[0]).toMatchObject({
            funder_id: funderId,
            filename: 'Award letter.txt',
            origin: 'email',
            uploaded_by_id: leslieId,
            read_status: 'queued',
        })

        // The webhook delivered again: nothing is filed twice.
        const again = await processInboundEmail({
            receivedEmailId: email.id,
            ai: fakeAi({ answers: [] }).provider,
            today: '2026-10-29',
            fetchReceivedEmail: async () => email,
            downloadAttachment: download,
        })
        expect(again).toMatchObject({ filed: 0 })
        expect(await db().attachment.count({ where: { received_email_id: email.id } })).toBe(1)
    })

    it('lets an instruction email file a deck with a fund', async () => {
        const { processInboundEmail } = await import('#server/utils/mail/inbound.ts')
        const { db } = await import('#server/utils/db.ts')
        const deck = new TextEncoder().encode('Iungo Capital investor deck. Founded in 2019.')
        const email = received({
            id: 'rcv_instruction_files',
            subject: 'Iungo deck',
            text: 'Here is the Iungo deck from our call.',
            attachments: [
                {
                    id: 'att_deck',
                    filename: 'Iungo deck.pdf.txt',
                    contentType: 'text/plain',
                    size: 800,
                    contentDisposition: 'attachment',
                },
            ],
        })
        const { provider, prompts } = fakeAi({
            answers: [{ kind: 'business_document', summary: 'Iungo Capital investor deck.' }],
            toolScripts: [
                {
                    calls: [
                        { name: 'find_funds', input: { query: 'Iungo' } },
                        {
                            name: 'attach_file',
                            input: { file_number: 1, funder_id: null, opportunity_id: null, fund_id: fundId },
                        },
                    ],
                    reply: 'Filed the deck with Iungo Capital.',
                },
            ],
        })
        const result = await processInboundEmail({
            receivedEmailId: email.id,
            ai: provider,
            today: '2026-10-29',
            fetchReceivedEmail: async () => email,
            downloadAttachment: async () => deck,
        })
        expect(result).toMatchObject({ kind: 'instructions', filed: 1 })
        expect(prompts.at(-1)).toContain('<file number="1" name="Iungo deck.pdf.txt">')
        const filed = await db().attachment.findFirstOrThrow({ where: { received_email_id: email.id } })
        expect(filed).toMatchObject({ fund_manager_id: fundId, origin: 'email' })
        expect(sentEmails.at(-1)!.text).toContain('Filed Iungo deck.pdf.txt with Iungo Capital')
    })

    it('files the attachments of past emails once, without replying', async () => {
        const { filePastEmailAttachments } = await import('#server/utils/mail/past-attachments.ts')
        const { db } = await import('#server/utils/db.ts')
        const pastEmail = received({
            id: 'rcv_past',
            createdAt: '2026-09-01T10:00:00Z',
            subject: 'Fwd: Proposal',
            attachments: [attachments[0]!],
        })
        const recentEmail = received({
            id: 'rcv_recent',
            createdAt: '2026-10-29T14:50:00Z',
            attachments: [attachments[0]!],
        })
        const listReceivedEmails = async () => ({
            emails: [recentEmail, pastEmail, received({ id: 'rcv_no_files', createdAt: '2026-09-01T09:00:00Z' })].map(
                email => ({
                    id: email.id,
                    createdAt: email.createdAt,
                    attachmentCount: email.attachments?.length ?? 0,
                }),
            ),
            hasMore: false,
        })
        const emailsById = new Map([pastEmail, recentEmail].map(email => [email.id, email]))
        const repliesBefore = sentEmails.length
        const { provider } = fakeAi({
            answers: [{ kind: 'business_document', summary: 'Award letter from UBS Optimus Foundation.' }],
        })
        const result = await filePastEmailAttachments({
            ai: provider,
            today: '2026-10-29',
            now,
            listReceivedEmails,
            fetchReceivedEmail: async ({ id }) => emailsById.get(id)!,
            downloadAttachment: download,
        })
        // The recent one is left to its webhook; the one without files is skipped.
        expect(result).toEqual({ emails_checked: 1, files_filed: 1, failed: 0 })
        expect(await db().attachment.findFirst({ where: { received_email_id: 'rcv_past' } })).toMatchObject({
            funder_id: funderId,
            created_at: new Date('2026-09-01T10:00:00Z'),
        })
        expect(sentEmails.length).toBe(repliesBefore)

        const again = await filePastEmailAttachments({
            ai: fakeAi({ answers: [] }).provider,
            today: '2026-10-29',
            now,
            listReceivedEmails,
            fetchReceivedEmail: async ({ id }) => emailsById.get(id)!,
            downloadAttachment: download,
        })
        expect(again).toEqual({ emails_checked: 0, files_filed: 0, failed: 0 })
    })
})
