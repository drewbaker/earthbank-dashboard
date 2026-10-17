import type { z } from 'zod'
import type { AiProvider, AiTool, StructuredResult } from '#server/utils/ai/provider.ts'
import type { WebResearcher } from '#server/utils/ai/web-research.ts'
import type { RetrievedPage, SearchResult } from '#server/utils/funds/verify-finding.ts'

/** A scripted tool-using run: the calls the fake model makes, in order, and its final reply. */
export type ToolScript = { calls: { name: string; input: Record<string, unknown> }[]; reply: string }

/**
 * An AI provider that returns canned answers and records every prompt it was sent.
 *
 * @param input.answers - Answers returned in order (null simulates a refusal).
 * @param input.toolScripts - For `runWithTools`: each run's tool calls (validated by the tool's own
 *   schema, like the real runner) and reply, in order.
 * @returns The provider, the prompts and reference texts it received, and each tool call's result.
 */
export function fakeAi({ answers, toolScripts = [] }: { answers: unknown[]; toolScripts?: ToolScript[] }) {
    const prompts: string[] = []
    const toolResults: { name: string; result: string }[] = []
    const references: (string | undefined)[] = []
    const provider: AiProvider = {
        name: 'fake',
        model: 'fake-model',
        async runWithTools({ prompt, tools }: { instructions: string; prompt: string; tools: AiTool[] }) {
            prompts.push(prompt)
            const script = toolScripts.shift() ?? { calls: [], reply: '' }
            for (const call of script.calls) {
                const tool = tools.find(candidate => candidate.name === call.name)
                if (!tool) {
                    throw new Error(`The fake model called an unknown tool: ${call.name}`)
                }
                toolResults.push({
                    name: call.name,
                    result: await tool.run(tool.inputSchema.parse(call.input) as never),
                })
            }
            return script.reply
        },
        async completeStructured<Schema extends z.ZodType>({
            reference,
            prompt,
            schema,
        }: {
            instructions: string
            reference?: string
            prompt: string
            schema: Schema
        }) {
            prompts.push(prompt)
            references.push(reference)
            const answer = answers.shift()
            if (answer === null || answer === undefined) {
                return { status: 'refused', output: null, model: 'fake-model' } satisfies StructuredResult<
                    z.infer<Schema>
                >
            }
            return { status: 'ok', output: schema.parse(answer), model: 'fake-model' } satisfies StructuredResult<
                z.infer<Schema>
            >
        },
    }
    return { provider, prompts, references, toolResults }
}

/** A scripted research run: what the fake "retrieved", the tool calls it then makes, and its cost. */
export type ResearchScript = {
    pages: RetrievedPage[]
    searchResults?: SearchResult[]
    calls: { name: string; input: Record<string, unknown> }[]
    costMicroUsd?: number
}

/**
 * A web researcher that "retrieves" scripted pages, then makes scripted tool calls (validated by each
 * tool's schema, like the real runner), and records the prompts it was sent.
 *
 * @param input.scripts - One script per research run, in order.
 * @returns The researcher, the prompts it received and each tool call's result.
 */
export function fakeWebResearcher({ scripts }: { scripts: ResearchScript[] }) {
    const prompts: string[] = []
    const toolResults: { name: string; result: string }[] = []
    const researcher: WebResearcher = {
        model: 'fake-research-model',
        async researchWithWeb({ prompt, tools, onRetrieved }) {
            prompts.push(prompt)
            const script = scripts.shift() ?? { pages: [], calls: [] }
            const searchResults = script.searchResults ?? []
            onRetrieved?.({ pages: script.pages, searchResults })
            for (const call of script.calls) {
                const tool = tools.find(candidate => candidate.name === call.name)
                if (!tool) {
                    throw new Error(`The fake researcher called an unknown tool: ${call.name}`)
                }
                toolResults.push({
                    name: call.name,
                    result: await tool.run(tool.inputSchema.parse(call.input) as never),
                })
            }
            return {
                text: 'Done.',
                model: 'fake-research-model',
                pages: script.pages,
                searchResults,
                usage: {
                    inputTokens: 1000,
                    outputTokens: 200,
                    webSearches: 3,
                    webFetches: script.pages.length,
                    costMicroUsd: script.costMicroUsd ?? 50_000,
                },
            }
        },
    }
    return { researcher, prompts, toolResults }
}
