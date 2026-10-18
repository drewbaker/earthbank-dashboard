import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'

// pdfmake is CommonJS that assigns one instance to module.exports, so ESM named imports can't see its
// functions; load it with require. Its own Roboto files cover accented names and most symbols.
const require = createRequire(import.meta.url)
const pdfmake = require('pdfmake') as typeof import('pdfmake')
const ROBOTO_DIR = join(dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto')
const FONT_FILES = {
    normal: join(ROBOTO_DIR, 'Roboto-Regular.ttf'),
    bold: join(ROBOTO_DIR, 'Roboto-Medium.ttf'),
    italics: join(ROBOTO_DIR, 'Roboto-Italic.ttf'),
    bolditalics: join(ROBOTO_DIR, 'Roboto-MediumItalic.ttf'),
}
const ALLOWED_FONT_PATHS = new Set(Object.values(FONT_FILES))

pdfmake.setFonts({ Roboto: FONT_FILES })
// Documents are built from our own data, which includes researched URLs: never let a document
// definition make the server fetch a URL or read any file other than the fonts.
pdfmake.setUrlAccessPolicy(() => false)
pdfmake.setLocalAccessPolicy(path => ALLOWED_FONT_PATHS.has(path))

/**
 * Render a pdfmake document definition to PDF bytes.
 *
 * @param input.document - The document: content, styles, page settings.
 * @returns The PDF file.
 */
export async function renderPdf({ document }: { document: TDocumentDefinitions }) {
    return pdfmake.createPdf({ defaultStyle: { font: 'Roboto' }, ...document }).getBuffer()
}
