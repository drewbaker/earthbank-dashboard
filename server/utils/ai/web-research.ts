import Anthropic from '@anthropic-ai/sdk'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { AiTool } from '#server/utils/ai/provider.ts'
import { config } from '#server/utils/config.ts'
import type { RetrievedPage, SearchResult } from '#server/utils/funds/verify-finding.ts'

/** Token and tool counts for one research run, and what it cost. */
export type WebResearchUsage = {
    inputTokens: number
    outputTokens: number
    webSearches: number
    webFetches: number
    costMicroUsd: number
}

/** What a web research run produced: the final text, every page and search result it saw, and usage. */
export type WebResearchResult = {
    text: string
    model: string
    pages: RetrievedPage[]
    searchResults: SearchResult[]
    usage: WebResearchUsage
}

export interface WebResearcher {
    model: string
    /**
     * Let the model search and read the public web, calling our tools to record what it finds.
     */
    researchWithWeb(input: {
        instructions: string
        prompt: string
        tools: AiTool[]
        maxSteps?: number
        maxSearches: number
        maxFetches: number
        onRetrieved?: (retrieved: { pages: RetrievedPage[]; searchResults: SearchResult[] }) => void
    }): Promise<WebResearchResult>
}

// US dollars per million tokens (Anthropic list prices). Unknown models count at Opus rates so the
// budget errs on the safe side.
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
    'claude-sonnet-5-5': { input: 2, output: 10 },
    'claude-opus-5-5': { input: 4, output: 20 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5 },
}
const FALLBACK_PRICE = { input: 4, output: 20 }
const WEB_SEARCH_USD = 0.01

/**
 * Claude with Anthropic's server-side web search and web fetch tools, plus our recording tools.
 *
 * Uses the basic web tool versions on purpose: the newer ones filter pages in code before the model
 * sees them, and research verification needs the full text of every fetched page.
 */
export class AnthropicWebResearcher implements WebResearcher {
    readonly model: string
    private readonly client: Anthropic

    /**
     * @param input.apiKey - Anthropic API key.
     * @param input.model - Model id, e.g. `claude-sonnet-5-5`.
     * @param input.client - Pre-built client (tests).
     */
    constructor({ apiKey, model, client }: { apiKey: string; model: string; client?: Anthropic }) {
        this.model = model
        this.client = client ?? new Anthropic({ apiKey })
    }

    /**
     * Run one research session to completion.
     *
     * @param input.instructions - System prompt.
     * @param input.prompt - What to research.
     * @param input.tools - Recording tools the model calls with its findings.
     * @param input.maxSteps - Most model turns before stopping.
     * @param input.maxSearches - Most web searches.
     * @param input.maxFetches - Most page fetches.
     * @param input.onRetrieved - Called with each response's new pages and search results, before the
     *   tools that response called run (so tools can check claims against them).
     * @returns The final text, the pages and search results seen, and usage.
     */
    async researchWithWeb({
        instructions,
        prompt,
        tools,
        maxSteps = 40,
        maxSearches,
        maxFetches,
        onRetrieved,
    }: {
        instructions: string
        prompt: string
        tools: AiTool[]
        maxSteps?: number
        maxSearches: number
        maxFetches: number
        onRetrieved?: (retrieved: { pages: RetrievedPage[]; searchResults: SearchResult[] }) => void
    }): Promise<WebResearchResult> {
        const runner = this.client.beta.messages.toolRunner({
            model: this.model,
            max_tokens: 16000,
            max_iterations: maxSteps,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: instructions,
            output_config: { effort: 'medium' },
            tools: [
                { type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches },
                { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: maxFetches, max_content_tokens: 30000 },
                ...tools.map(tool =>
                    betaZodTool({
                        name: tool.name,
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                        run: input => tool.run(input as never),
                    }),
                ),
            ],
            messages: [{ role: 'user', content: prompt }],
        })

        const pages: RetrievedPage[] = []
        const searchResults: SearchResult[] = []
        const usage: WebResearchUsage = {
            inputTokens: 0,
            outputTokens: 0,
            webSearches: 0,
            webFetches: 0,
            costMicroUsd: 0,
        }
        let text = ''
        let model = this.model
        for await (const message of runner) {
            model = message.model
            addUsage({ usage, message })
            text =
                message.content
                    .flatMap(block => (block.type === 'text' ? [block.text] : []))
                    .join('\n')
                    .trim() || text
            const newPages: RetrievedPage[] = []
            const newSearchResults: SearchResult[] = []
            for (const block of message.content) {
                if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
                    newSearchResults.push(...block.content.map(result => ({ url: result.url, title: result.title })))
                }
                if (block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result') {
                    const page = await pageFromFetch({ fetched: block.content })
                    if (page) {
                        newPages.push(page)
                    }
                }
            }
            pages.push(...newPages)
            searchResults.push(...newSearchResults)
            onRetrieved?.({ pages: newPages, searchResults: newSearchResults })
        }
        return { text, model, pages, searchResults, usage }
    }
}

/**
 * The researcher used for fund research, or null without an API key.
 *
 * @returns The researcher on `RESEARCH_AI_MODEL`, or null.
 */
export function webResearcher(): WebResearcher | null {
    return config.anthropicApiKey
        ? new AnthropicWebResearcher({ apiKey: config.anthropicApiKey, model: config.researchAiModel })
        : null
}

/**
 * What a run's token and tool usage cost, in millionths of a US dollar.
 *
 * @param input.model - Model id.
 * @param input.inputTokens - Input tokens (cache writes and reads already folded in at full price).
 * @param input.outputTokens - Output tokens.
 * @param input.webSearches - Web searches made.
 * @returns Cost in micro-dollars.
 */
export function researchCostMicroUsd({
    model,
    inputTokens,
    outputTokens,
    webSearches,
}: {
    model: string
    inputTokens: number
    outputTokens: number
    webSearches: number
}) {
    const price = MODEL_PRICES[model] ?? FALLBACK_PRICE
    const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000 + webSearches * WEB_SEARCH_USD
    return Math.round(usd * 1_000_000)
}

/**
 * Add one response's usage to the running totals.
 *
 * Cache writes and reads are counted as plain input: slightly over-counts, which keeps the budget safe.
 *
 * @param input.usage - Running totals (mutated).
 * @param input.message - One response from the tool runner.
 * @returns Nothing.
 */
function addUsage({ usage, message }: { usage: WebResearchUsage; message: Anthropic.Beta.BetaMessage }) {
    const inputTokens =
        message.usage.input_tokens +
        (message.usage.cache_creation_input_tokens ?? 0) +
        (message.usage.cache_read_input_tokens ?? 0)
    const webSearches = message.usage.server_tool_use?.web_search_requests ?? 0
    usage.inputTokens += inputTokens
    usage.outputTokens += message.usage.output_tokens
    usage.webSearches += webSearches
    usage.webFetches += message.usage.server_tool_use?.web_fetch_requests ?? 0
    usage.costMicroUsd += researchCostMicroUsd({
        model: message.model,
        inputTokens,
        outputTokens: message.usage.output_tokens,
        webSearches,
    })
}

/**
 * Turn a web_fetch result into page text (PDFs are decoded with unpdf).
 *
 * @param input.fetched - The fetch result block content.
 * @returns The page, or null when it has no readable text.
 */
async function pageFromFetch({
    fetched,
}: {
    fetched: Anthropic.Beta.BetaWebFetchBlock
}): Promise<RetrievedPage | null> {
    const source = fetched.content.source
    if (source.type === 'text') {
        return { url: fetched.url, title: fetched.content.title, text: source.data }
    }
    try {
        const { extractText, getDocumentProxy } = await import('unpdf')
        const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(source.data, 'base64')))
        const { text } = await extractText(pdf, { mergePages: true })
        return { url: fetched.url, title: fetched.content.title, text }
    } catch (error) {
        console.error('[research] PDF text extraction failed', fetched.url, error)
        return null
    }
}
