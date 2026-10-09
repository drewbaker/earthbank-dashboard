import type { z } from 'zod'
import type { AiProvider, AiTool, StructuredResult } from '#server/utils/ai/provider.ts'

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
