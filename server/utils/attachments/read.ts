import { findAttachment, updateAttachmentRead } from '#server/database/attachments.ts'
import { findFundManager } from '#server/database/fund-managers.ts'
import { findUser } from '#server/database/users.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { readFunderDocument } from '#server/utils/attachments/funder-document.ts'
import { isReadableType, UNREADABLE_FILE_SUMMARY } from '#server/utils/attachments/files.ts'
import { config } from '#server/utils/config.ts'
import { importFundNote } from '#server/utils/funds/import-note.ts'
import { extractText } from '#server/utils/knowledge/extract.ts'
import { sensitiveReasonFromName, sensitiveReasonFromText } from '#server/utils/knowledge/sensitive.ts'
import { readStoredFile } from '#server/utils/storage.ts'
import type { AttachmentReadCounts } from '#shared/schemas/index.ts'

const NO_COUNTS: AttachmentReadCounts = { facts: 0, people: 0, diligence: 0, applied: 0, pending: 0, contacts: 0 }

/**
 * Have the AI read a funder or fund file. A fund file fills the fund's research and due diligence the
 * way an imported note does (every fact quoted from the file and credited to it); a funder file updates
 * the funder's asks the way an email does. Personal documents (IDs, tax forms…) and files without text
 * are skipped, and nothing is read from them.
 *
 * @param input.attachmentId - The file.
 * @param input.ai - The AI provider.
 * @param input.now - When it's read.
 * @returns What happened.
 * @throws Error when reading fails (after marking the file failed), so the job retries.
 */
export async function readAttachment({ attachmentId, ai, now }: { attachmentId: string; ai: AiProvider; now: Date }) {
    const attachment = await findAttachment({ attachmentId })
    if (!attachment || (!attachment.funder_id && !attachment.fund_manager_id)) {
        return { status: 'skipped' as const, reason: 'not a funder or fund file' }
    }
    const skip = async ({ summary }: { summary: string }) => {
        await updateAttachmentRead({
            attachmentId,
            data: { read_status: 'skipped', read_summary: summary, read_error: null, read_at: now },
        })
        return { status: 'skipped' as const, reason: summary }
    }
    if (!isReadableType({ type: attachment.content_type })) {
        return skip({ summary: UNREADABLE_FILE_SUMMARY })
    }
    const nameReason = sensitiveReasonFromName({ name: attachment.filename })
    if (nameReason) {
        return skip({ summary: `Not read: the file ${nameReason}, and personal documents aren't read.` })
    }
    await updateAttachmentRead({ attachmentId, data: { read_status: 'reading', read_error: null } })
    try {
        const text = await extractText({
            data: await readStoredFile({ key: attachment.storage_key }),
            contentMimeType: attachment.content_type,
        })
        if (!text.trim()) {
            return skip({ summary: 'Not read: no text found in the file (a scanned PDF has only images).' })
        }
        const textReason = sensitiveReasonFromText({ text })
        if (textReason) {
            return skip({ summary: `Not read: the file ${textReason}, and personal documents aren't read.` })
        }
        const outcome = attachment.fund_manager_id
            ? await readFundFile({
                  fundManagerId: attachment.fund_manager_id,
                  attachment: { id: attachment.id, filename: attachment.filename },
                  uploadedById: attachment.uploaded_by_id,
                  text,
                  ai,
                  now,
              })
            : await readFunderFile({
                  funderId: attachment.funder_id!,
                  attachment: { id: attachment.id, filename: attachment.filename },
                  opportunityId: attachment.opportunity_id,
                  receivedAt: attachment.created_at,
                  text,
                  ai,
              })
        await updateAttachmentRead({
            attachmentId,
            data: {
                read_status: 'done',
                read_summary: outcome.summary,
                read_error: null,
                read_counts: outcome.counts,
                read_at: now,
                ...(outcome.opportunityId && !attachment.opportunity_id
                    ? { opportunity_id: outcome.opportunityId }
                    : {}),
            },
        })
        return { status: 'done' as const, counts: outcome.counts }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[attachments] reading failed', attachmentId, message.slice(0, 200))
        await updateAttachmentRead({
            attachmentId,
            data: { read_status: 'failed', read_error: message.slice(0, 500), read_at: now },
        })
        throw error
    }
}

/**
 * Read a fund file into the fund's profile, as a note credited "{file} from {uploader} on {time}".
 *
 * @param input.fundManagerId - The fund.
 * @param input.attachment - The file's id and name.
 * @param input.uploadedById - Who uploaded or emailed it.
 * @param input.text - The file's text.
 * @param input.ai - The AI provider.
 * @param input.now - When it's read.
 * @returns A summary and counts.
 */
async function readFundFile({
    fundManagerId,
    attachment,
    uploadedById,
    text,
    ai,
    now,
}: {
    fundManagerId: string
    attachment: { id: string; filename: string }
    uploadedById: string | null
    text: string
    ai: AiProvider
    now: Date
}) {
    const fund = await findFundManager({ fundManagerId })
    if (!fund) {
        throw new Error('The fund no longer exists.')
    }
    const uploader = uploadedById ? await findUser({ userId: uploadedById }) : null
    const note = await importFundNote({
        fundManagerId,
        fundName: fund.name,
        author: { id: uploader?.id ?? null, name: uploader?.name ?? 'the team' },
        text,
        docUrl: null,
        attachment,
        // Read in a job, away from any browser, so the credit line uses the team's time zone.
        timeZone: config.defaultTimeZone,
        ai,
        now,
    })
    const counts = {
        ...NO_COUNTS,
        facts: note.findings_added,
        people: note.people_added,
        diligence: note.diligence_answered,
    }
    return { summary: fundFileSummary({ counts }), counts, opportunityId: null }
}

/**
 * Read a funder file into the funder's asks.
 *
 * @param input.funderId - The funder.
 * @param input.attachment - The file's id and name.
 * @param input.opportunityId - The ask it was filed with, if any.
 * @param input.receivedAt - When the file arrived.
 * @param input.text - The file's text.
 * @param input.ai - The AI provider.
 * @returns The AI's summary, counts and the ask it's about.
 */
async function readFunderFile({
    funderId,
    attachment,
    opportunityId,
    receivedAt,
    text,
    ai,
}: {
    funderId: string
    attachment: { id: string; filename: string }
    opportunityId: string | null
    receivedAt: Date
    text: string
    ai: AiProvider
}) {
    const reading = await readFunderDocument({
        funderId,
        attachmentId: attachment.id,
        filename: attachment.filename,
        text,
        opportunityId,
        receivedAt,
        ai,
    })
    return {
        summary: reading.summary,
        counts: { ...NO_COUNTS, ...reading.counts },
        opportunityId: reading.opportunityId,
    }
}

/**
 * One line on what a fund file added.
 *
 * @param input.counts - What it added.
 * @returns e.g. "Added 5 facts, 2 people and 1 diligence answer."
 */
export function fundFileSummary({ counts }: { counts: AttachmentReadCounts }) {
    const parts = [
        counts.facts ? `${counts.facts} ${counts.facts === 1 ? 'fact' : 'facts'}` : null,
        counts.people ? `${counts.people} ${counts.people === 1 ? 'person' : 'people'}` : null,
        counts.diligence ? `${counts.diligence} diligence ${counts.diligence === 1 ? 'answer' : 'answers'}` : null,
    ].filter((part): part is string => part !== null)
    if (parts.length === 0) {
        return 'Read; nothing new about this fund was found in it.'
    }
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
    return `Added ${list} to the research.`
}
