import { unzipSync } from 'fflate'
import mammoth from 'mammoth'
import readXlsxFile from 'read-excel-file/node'

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const PDF_MIME_TYPE = 'application/pdf'
const DOWNLOADABLE_MIME_TYPES = new Set([PDF_MIME_TYPE, XLSX_MIME_TYPE, DOCX_MIME_TYPE, PPTX_MIME_TYPE])
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
 * How to get a file's content from Drive, or null when the type isn't supported (images, old binary
 * .doc/.ppt files, …; converting those to Google Docs or Slides makes them readable).
 *
 * @param input.mimeType - Drive MIME type.
 * @returns The plan, or null.
 */
export function contentPlan({ mimeType }: { mimeType: string }): ContentPlan | null {
    const exportMimeType = GOOGLE_EXPORTS[mimeType]
    if (exportMimeType) {
        return { action: 'export', exportMimeType }
    }
    if (DOWNLOADABLE_MIME_TYPES.has(mimeType) || PLAIN_TEXT_MIME_TYPES.has(mimeType)) {
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
    if (contentMimeType === DOCX_MIME_TYPE) {
        return (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value
    }
    if (contentMimeType === PPTX_MIME_TYPE) {
        return presentationText({ files: unzipSync(data) })
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

/**
 * A .pptx deck as text: each slide's text boxes in order, then its speaker notes. A .pptx is a zip of
 * XML parts; text sits in `<a:t>` runs grouped into `<a:p>` paragraphs.
 *
 * @param input.files - The unzipped parts, keyed by path.
 * @returns The text, one "## Slide N" section per slide.
 */
export function presentationText({ files }: { files: Record<string, Uint8Array> }) {
    const decoder = new TextDecoder('utf-8')
    const slideNumbers = Object.keys(files)
        .flatMap(path => {
            const match = path.match(/^ppt\/slides\/slide(\d+)\.xml$/)
            return match ? [Number(match[1])] : []
        })
        .sort((first, second) => first - second)
    return slideNumbers
        .map(number => {
            const slide = xmlParagraphs({ xml: decoder.decode(files[`ppt/slides/slide${number}.xml`]) })
            const notesPart = files[`ppt/notesSlides/notesSlide${number}.xml`]
            // Notes pages repeat the slide number in a placeholder; drop bare numbers.
            const notes = notesPart
                ? xmlParagraphs({ xml: decoder.decode(notesPart) }).filter(line => !/^\d+$/.test(line))
                : []
            return [`## Slide ${number}`, ...slide, ...(notes.length ? [`Notes: ${notes.join(' ')}`] : [])].join('\n')
        })
        .join('\n\n')
}

/**
 * The non-empty paragraphs of an Office XML part, with entities decoded.
 *
 * @param input.xml - The XML text.
 * @returns One string per paragraph.
 */
function xmlParagraphs({ xml }: { xml: string }) {
    return (xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) ?? [])
        .map(paragraph =>
            (paragraph.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? [])
                .map(run => decodeXmlEntities({ text: run.replace(/<\/?a:t>/g, '') }))
                .join(''),
        )
        .map(line => line.trim())
        .filter(Boolean)
}

/**
 * Decode the XML entities Office writes (&amp; &lt; &gt; &quot; &apos; and numeric ones).
 *
 * @param input.text - Text with entities.
 * @returns Plain text.
 */
function decodeXmlEntities({ text }: { text: string }) {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
        if (code.startsWith('#x') || code.startsWith('#X')) {
            return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
        }
        if (code.startsWith('#')) {
            return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
        }
        return named[code] ?? entity
    })
}
