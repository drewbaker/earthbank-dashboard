import { strToU8, zipSync } from 'fflate'

/**
 * A minimal but valid .docx with one paragraph per line.
 *
 * @param input.paragraphs - Paragraph texts.
 * @returns The file bytes.
 */
export function buildDocx({ paragraphs }: { paragraphs: string[] }) {
    const body = paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
    return zipSync({
        '[Content_Types].xml': strToU8(
            '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
        '_rels/.rels': strToU8(
            '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ),
        'word/document.xml': strToU8(
            `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
        ),
    })
}

/**
 * The parts of a .pptx that carry text: slides (and notes), each a list of paragraphs.
 *
 * @param input.slides - Per slide: its paragraphs and optional speaker notes.
 * @returns The zipped file bytes.
 */
export function buildPptx({ slides }: { slides: { paragraphs: string[]; notes?: string[] }[] }) {
    const paragraphsXml = (paragraphs: string[]) =>
        paragraphs.map(text => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`).join('')
    const files: Record<string, Uint8Array> = {}
    slides.forEach((slide, index) => {
        files[`ppt/slides/slide${index + 1}.xml`] = strToU8(
            `<p:sld xmlns:a="a" xmlns:p="p"><p:txBody>${paragraphsXml(slide.paragraphs)}</p:txBody></p:sld>`,
        )
        if (slide.notes) {
            files[`ppt/notesSlides/notesSlide${index + 1}.xml`] = strToU8(
                `<p:notes xmlns:a="a" xmlns:p="p"><p:txBody>${paragraphsXml([...slide.notes, String(index + 1)])}</p:txBody></p:notes>`,
            )
        }
    })
    return zipSync(files)
}
