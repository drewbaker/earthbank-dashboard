import readXlsxFile from 'read-excel-file/node'

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PDF_MIME_TYPE = 'application/pdf'
const PLAIN_TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv'])

// Google's own formats are exported: Docs and Slides as text, Sheets as .xlsx so every tab is read
// (a CSV export only has the first tab).
const GOOGLE_EXPORTS: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.spreadsheet': XLSX_MIME_TYPE,
}

/** Longest text kept per document; a long spreadsheet shouldn't crowd out everything else. */
export const MAX_DOCUMENT_CHARACTERS = 100_000

export type ContentPlan = { action: 'export'; exportMimeType: string } | { action: 'download'; mimeType: string }

/**
 * How to get a file's content from Drive, or null when the type isn't supported (Word and
 * PowerPoint files, images, …; converting them to Google Docs or Slides makes them readable).
 *
 * @param input.mimeType - Drive MIME type.
 * @returns The plan, or null.
 */
export function contentPlan({ mimeType }: { mimeType: string }): ContentPlan | null {
    const exportMimeType = GOOGLE_EXPORTS[mimeType]
    if (exportMimeType) {
        return { action: 'export', exportMimeType }
    }
    if (mimeType === PDF_MIME_TYPE || mimeType === XLSX_MIME_TYPE || PLAIN_TEXT_MIME_TYPES.has(mimeType)) {
        return { action: 'download', mimeType }
    }
    return null
}

/**
 * Turn downloaded or exported file content into plain text, capped at `MAX_DOCUMENT_CHARACTERS`.
 *
 * @param input.data - The file content.
 * @param input.contentMimeType - Type of `data` (the export type for Google files).
 * @returns The text.
 */
export async function extractText({ data, contentMimeType }: { data: Uint8Array; contentMimeType: string }) {
    const text = await rawText({ data, contentMimeType })
    const tidy = text
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    return tidy.length > MAX_DOCUMENT_CHARACTERS ? `${tidy.slice(0, MAX_DOCUMENT_CHARACTERS)}\n[…truncated]` : tidy
}

/**
 * Text of one file type, before tidying.
 *
 * @param input.data - The file content.
 * @param input.contentMimeType - Type of `data`.
 * @returns The text.
 */
async function rawText({ data, contentMimeType }: { data: Uint8Array; contentMimeType: string }) {
    if (contentMimeType === PDF_MIME_TYPE) {
        const { extractText: extractPdfText, getDocumentProxy } = await import('unpdf')
        const pdf = await getDocumentProxy(new Uint8Array(data))
        const { text } = await extractPdfText(pdf, { mergePages: true })
        return text
    }
    if (contentMimeType === XLSX_MIME_TYPE) {
        return spreadsheetText({ sheets: await readXlsxFile(Buffer.from(data)) })
    }
    return new TextDecoder('utf-8').decode(data)
}

/**
 * Spreadsheet tabs as text: a heading per tab, then one line per non-empty row with cells joined by `|`.
 *
 * @param input.sheets - Tabs and their rows.
 * @returns The text.
 */
export function spreadsheetText({ sheets }: { sheets: { sheet: string; data: unknown[][] }[] }) {
    return sheets
        .map(({ sheet, data }) => {
            const rows = data
                .map(row => row.map(cell => cellText({ cell })))
                .filter(cells => cells.some(Boolean))
                .map(cells => cells.join(' | ').replace(/( \| )+$/, ''))
            return rows.length ? `## ${sheet}\n${rows.join('\n')}` : ''
        })
        .filter(Boolean)
        .join('\n\n')
}

/**
 * One spreadsheet cell as text.
 *
 * @param input.cell - The cell value.
 * @returns Text (empty for blank cells).
 */
function cellText({ cell }: { cell: unknown }) {
    if (cell === null || cell === undefined) {
        return ''
    }
    if (cell instanceof Date) {
        return cell.toISOString().slice(0, 10)
    }
    if (typeof cell === 'number') {
        return Number.isInteger(cell) ? String(cell) : String(Math.round(cell * 10000) / 10000)
    }
    return String(cell).replace(/\s+/g, ' ').trim()
}
