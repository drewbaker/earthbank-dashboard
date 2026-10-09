/** About 75k tokens: room for a whole folder of business documents with plenty left for the email. */
export const KNOWLEDGE_BUDGET_CHARACTERS = 300_000
const CHUNK_CHARACTERS = 1500

const STOP_WORDS = new Set(
    'the and for are but not you all any can had her was one our out has have this that with they will from your what when were been their there about would which them into than then some could other more also just like only over such very these those here thanks thank regards best dear hello please'.split(
        ' ',
    ),
)

export type KnowledgeDocumentText = {
    id: string
    name: string
    web_view_link: string | null
    text: string | null
    is_pinned: boolean
}

export type KnowledgeSelection = {
    /** The documents as text for the AI's reference block; empty when there are none. */
    reference: string
    /** Documents included, whole or in part. */
    documents: { id: string; name: string; web_view_link: string | null }[]
    /** True when every usable document was included in full. */
    isComplete: boolean
}

/**
 * Choose which document text the AI reads. When everything fits the budget, every document goes in
 * whole, in a stable order so the prompt can be cached. Otherwise pinned documents go in whole, and
 * the rest of the budget is filled with the passages that best match the email (BM25).
 *
 * @param input.documents - Usable documents with their text.
 * @param input.query - Text to match passages against (the email thread, the ask).
 * @param input.budgetCharacters - Most characters to include.
 * @returns The reference text and which documents it came from.
 */
export function selectKnowledge({
    documents,
    query,
    budgetCharacters = KNOWLEDGE_BUDGET_CHARACTERS,
}: {
    documents: KnowledgeDocumentText[]
    query: string
    budgetCharacters?: number
}): KnowledgeSelection {
    const usable = documents
        .filter(document => document.text?.trim())
        .sort(
            (first, second) => Number(second.is_pinned) - Number(first.is_pinned) || first.id.localeCompare(second.id),
        )
    const total = usable.reduce((sum, document) => sum + document.text!.length, 0)
    if (total <= budgetCharacters) {
        return {
            reference: usable
                .map(document => renderDocument({ name: document.name, body: document.text! }))
                .join('\n\n'),
            documents: usable.map(document => summarize({ document })),
            isComplete: true,
        }
    }

    let remaining = budgetCharacters
    const included: { document: KnowledgeDocumentText; body: string; isExcerpt: boolean }[] = []
    for (const document of usable.filter(candidate => candidate.is_pinned)) {
        if (document.text!.length <= remaining) {
            included.push({ document, body: document.text!, isExcerpt: false })
            remaining -= document.text!.length
        }
    }

    const chunks = usable
        .filter(document => !document.is_pinned)
        .flatMap(document =>
            chunkText({ text: document.text! }).map((text, position) => ({ document, text, position })),
        )
    const scores = scoreChunks({ chunks: chunks.map(chunk => chunk.text), query })
    const chosen = chunks
        .map((chunk, index) => ({ ...chunk, score: scores[index]! }))
        .filter(chunk => chunk.score > 0)
        .sort((first, second) => second.score - first.score)
        .filter(chunk => {
            if (chunk.text.length > remaining) {
                return false
            }
            remaining -= chunk.text.length
            return true
        })

    // Group passages by document, in reading order.
    const byDocument = new Map<string, typeof chosen>()
    for (const chunk of chosen) {
        byDocument.set(chunk.document.id, [...(byDocument.get(chunk.document.id) ?? []), chunk])
    }
    for (const passages of byDocument.values()) {
        passages.sort((first, second) => first.position - second.position)
        included.push({
            document: passages[0]!.document,
            body: passages.map(passage => passage.text).join('\n[…]\n'),
            isExcerpt: true,
        })
    }

    return {
        reference: included
            .map(({ document, body, isExcerpt }) => renderDocument({ name: document.name, body, isExcerpt }))
            .join('\n\n'),
        documents: included.map(({ document }) => summarize({ document })),
        isComplete: false,
    }
}

/**
 * Split text into passages of about `CHUNK_CHARACTERS`, breaking between paragraphs where possible.
 *
 * @param input.text - Document text.
 * @returns Passages.
 */
export function chunkText({ text }: { text: string }) {
    const chunks: string[] = []
    let current = ''
    for (const paragraph of text.split(/\n{2,}/)) {
        const pieces =
            paragraph.length > CHUNK_CHARACTERS
                ? (paragraph.match(new RegExp(`[\\s\\S]{1,${CHUNK_CHARACTERS}}`, 'g')) ?? [])
                : [paragraph]
        for (const piece of pieces) {
            if (current && current.length + piece.length + 2 > CHUNK_CHARACTERS) {
                chunks.push(current)
                current = ''
            }
            current = current ? `${current}\n\n${piece}` : piece
        }
    }
    if (current.trim()) {
        chunks.push(current)
    }
    return chunks
}

/**
 * BM25 relevance of each passage to the query.
 *
 * @param input.chunks - Passages.
 * @param input.query - What to match.
 * @returns One score per passage (0 when no query word appears).
 */
export function scoreChunks({ chunks, query }: { chunks: string[]; query: string }) {
    const queryTerms = [...new Set(terms({ text: query }))]
    const chunkTerms = chunks.map(chunk => terms({ text: chunk }))
    const averageLength = chunkTerms.reduce((sum, words) => sum + words.length, 0) / Math.max(1, chunkTerms.length)
    const documentFrequency = new Map<string, number>()
    for (const words of chunkTerms) {
        for (const word of new Set(words)) {
            documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1)
        }
    }
    const k1 = 1.2
    const b = 0.75
    return chunkTerms.map(words => {
        const frequency = new Map<string, number>()
        for (const word of words) {
            frequency.set(word, (frequency.get(word) ?? 0) + 1)
        }
        return queryTerms.reduce((score, term) => {
            const count = frequency.get(term) ?? 0
            if (!count) {
                return score
            }
            const df = documentFrequency.get(term) ?? 0
            const idf = Math.log(1 + (chunkTerms.length - df + 0.5) / (df + 0.5))
            return score + (idf * count * (k1 + 1)) / (count + k1 * (1 - b + (b * words.length) / averageLength))
        }, 0)
    })
}

/**
 * Lowercase words of three or more letters, without common filler words.
 *
 * @param input.text - Any text.
 * @returns Words.
 */
function terms({ text }: { text: string }) {
    return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? []).filter(word => !STOP_WORDS.has(word))
}

/**
 * One document wrapped for the prompt.
 *
 * @param input.name - Document name.
 * @param input.body - Its text (or excerpts).
 * @param input.isExcerpt - Whether only parts are included.
 * @returns The wrapped text.
 */
function renderDocument({ name, body, isExcerpt = false }: { name: string; body: string; isExcerpt?: boolean }) {
    const title = name.replace(/["<>]/g, "'")
    return `<document name="${title}"${isExcerpt ? ' excerpts="true"' : ''}>\n${body}\n</document>`
}

/**
 * The public parts of a document.
 *
 * @param input.document - The document.
 * @returns Id, name and Drive link.
 */
function summarize({ document }: { document: KnowledgeDocumentText }) {
    return { id: document.id, name: document.name, web_view_link: document.web_view_link }
}
