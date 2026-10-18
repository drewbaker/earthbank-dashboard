import { config } from '#server/utils/config.ts'

/**
 * Where a fact taken from an imported note links to: the Google Doc itself, or the note on the fund's
 * Import tab for pasted text. Each import gets its own address (the doc link carries the note id in
 * its fragment), so two imports of the same doc stay two sources.
 *
 * @param input.note - The note's id, fund and Google Doc link.
 * @returns An absolute URL.
 */
export function fundNoteSourceUrl({ note }: { note: { id: string; fund_manager_id: string; doc_url: string | null } }) {
    if (note.doc_url) {
        return `${note.doc_url.split('#')[0]}#earthbank-note-${note.id}`
    }
    return `${config.appUrl}/funds/${note.fund_manager_id}?tab=import&note=${note.id}`
}

/**
 * How facts from a note are credited: "Note from Drew Baker on Oct 18, 2026, 3:04 PM".
 *
 * @param input.authorName - Who imported it.
 * @param input.at - When.
 * @param input.timeZone - The importer's time zone, so the time reads as they saw it.
 * @returns The title.
 */
export function fundNoteTitle({ authorName, at, timeZone }: { authorName: string; at: Date; timeZone: string }) {
    const when = at.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone })
    return `Note from ${authorName} on ${when}`
}
