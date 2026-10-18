import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

export const FUND_NOTE_INCLUDE = { author: true } satisfies Prisma.FundNoteInclude
export type FundNoteRow = Prisma.FundNoteGetPayload<{ include: typeof FUND_NOTE_INCLUDE }>

/**
 * Record a note being imported (before the AI reads it).
 *
 * @param input.fundManagerId - The fund.
 * @param input.authorUserId - Who imported it.
 * @param input.origin - `pasted` or `google_doc`.
 * @param input.docUrl - The Google Doc link, for docs.
 * @param input.title - "Note from Drew on Oct 18, 2026, 3:04 PM".
 * @param input.text - The note's text.
 * @param input.now - Import time.
 * @returns The note row.
 */
export function createFundNote({
    fundManagerId,
    authorUserId,
    origin,
    docUrl,
    title,
    text,
    now,
}: {
    fundManagerId: string
    authorUserId: string
    origin: 'pasted' | 'google_doc'
    docUrl: string | null
    title: string
    text: string
    now: Date
}) {
    return db().fundNote.create({
        data: {
            id: newId({ kind: 'fundNote', now: now.getTime() }),
            fund_manager_id: fundManagerId,
            author_user_id: authorUserId,
            origin,
            doc_url: docUrl,
            title,
            text,
        },
    })
}

/**
 * Record how an import went.
 *
 * @param input.fundNoteId - The note.
 * @param input.data - Status, counts and any error.
 * @returns The note row with its author.
 */
export function finishFundNote({
    fundNoteId,
    data,
}: {
    fundNoteId: string
    data: {
        status: 'done' | 'failed'
        error?: string | null
        findings_added?: number
        people_added?: number
        diligence_answered?: number
        dropped?: number
        kept_existing?: { question: string; answer: string }[]
    }
}) {
    return db().fundNote.update({ where: { id: fundNoteId }, data, include: FUND_NOTE_INCLUDE })
}

/**
 * A fund's imported notes, newest first.
 *
 * @param input.fundManagerId - The fund.
 * @returns Notes with their authors.
 */
export function listFundNotes({ fundManagerId }: { fundManagerId: string }) {
    return db().fundNote.findMany({
        where: { fund_manager_id: fundManagerId },
        include: FUND_NOTE_INCLUDE,
        orderBy: { created_at: 'desc' },
    })
}

/**
 * Save diligence answers taken from a note, credited to the person who imported it. They fill
 * unanswered questions and replace AI answers; a person's existing answer is kept and returned, so
 * the import can show what the note said instead.
 *
 * @param input.fundManagerId - The fund.
 * @param input.fundNoteId - The note they came from.
 * @param input.authorUserId - Who imported the note.
 * @param input.answers - Verified answers: question, answer and the note's source URL.
 * @returns How many were saved, and the ones kept as they were.
 */
export function saveNoteDiligenceAnswers({
    fundManagerId,
    fundNoteId,
    authorUserId,
    answers,
}: {
    fundManagerId: string
    fundNoteId: string
    authorUserId: string
    answers: { question: string; answer: string; sourceUrls: string[] }[]
}) {
    return db().$transaction(async tx => {
        let saved = 0
        const keptExisting: { question: string; answer: string }[] = []
        for (const answer of answers) {
            const existing = await tx.fundDiligenceAnswer.findUnique({
                where: { fund_manager_id_question: { fund_manager_id: fundManagerId, question: answer.question } },
            })
            if (existing?.source === 'manual' && existing.answer.trim() !== answer.answer.trim()) {
                keptExisting.push({ question: answer.question, answer: answer.answer })
                continue
            }
            const fields = {
                answer: answer.answer,
                source: 'manual',
                source_urls: answer.sourceUrls,
                answered_by_user_id: authorUserId,
                fund_note_id: fundNoteId,
            }
            await tx.fundDiligenceAnswer.upsert({
                where: { fund_manager_id_question: { fund_manager_id: fundManagerId, question: answer.question } },
                create: {
                    id: newId({ kind: 'fundDiligenceAnswer' }),
                    fund_manager_id: fundManagerId,
                    question: answer.question,
                    ...fields,
                },
                update: fields,
            })
            saved += 1
        }
        return { saved, keptExisting }
    })
}
