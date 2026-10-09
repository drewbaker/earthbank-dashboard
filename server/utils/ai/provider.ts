import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { z } from 'zod'
import { config } from '#server/utils/config.ts'

export type StructuredResult<Output> =
    { status: 'ok'; output: Output; model: string } | { status: 'refused' | 'unparseable'; output: null; model: string }

export type AiEffort = 'low' | 'medium' | 'high'

/** An action the AI may take, with a zod-validated input and a function that does it. */
export type AiTool = {
    name: string
    description: string
    inputSchema: z.ZodObject
    run: (input: never) => Promise<string>
}

export interface AiProvider {
    name: string
    model: string
    /**
     * Let the model work through a request using tools; returns its final written answer.
     */
    runWithTools(input: { instructions: string; prompt: string; tools: AiTool[]; maxSteps?: number }): Promise<string>
    completeStructured<Schema extends z.ZodType>(input: {
        instructions: string
        reference?: string
        prompt: string
        schema: Schema
        effort?: AiEffort
    }): Promise<StructuredResult<z.infer<Schema>>>
}

/**
 * Claude via the Anthropic API, returning output that matches a zod schema (structured outputs).
 *
 * Refusal fallbacks are on: if the model declines, the API retries on a fallback model in the same
 * call. Thinking stays adaptive; effort defaults to low because classification is a short, well-defined
 * task, and drafting asks for more.
 */
export class AnthropicProvider implements AiProvider {
    readonly name = 'anthropic'
    readonly model: string
    private readonly client: Anthropic

    /**
     * @param input.apiKey - Anthropic API key.
     * @param input.model - Model id, e.g. `claude-opus-5-5`.
     * @param input.client - Pre-built client (tests).
     */
    constructor({ apiKey, model, client }: { apiKey: string; model: string; client?: Anthropic }) {
        this.model = model
        this.client = client ?? new Anthropic({ apiKey })
    }

    /**
     * Ask for one structured answer.
     *
     * @param input.instructions - System prompt.
     * @param input.reference - Large, rarely changing reference text (Drive documents). It goes after
     *   the instructions in the system prompt and is cached, so repeat drafts don't pay for it again.
     * @param input.prompt - The user message (email and context).
     * @param input.schema - zod schema the answer must match.
     * @param input.effort - How hard the model thinks; `low` by default.
     * @returns The parsed output, or a refused/unparseable status.
     */
    async completeStructured<Schema extends z.ZodType>({
        instructions,
        reference,
        prompt,
        schema,
        effort = 'low',
    }: {
        instructions: string
        reference?: string
        prompt: string
        schema: Schema
        effort?: AiEffort
    }): Promise<StructuredResult<z.infer<Schema>>> {
        const response = await this.client.beta.messages.parse({
            model: this.model,
            max_tokens: effort === 'low' ? 4096 : 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: reference
                ? [
                      { type: 'text', text: instructions },
                      { type: 'text', text: reference, cache_control: { type: 'ephemeral' } },
                  ]
                : instructions,
            output_config: { effort, format: betaZodOutputFormat(schema) },
            messages: [{ role: 'user', content: prompt }],
        })
        if (response.stop_reason === 'refusal') {
            return { status: 'refused', output: null, model: response.model }
        }
        if (!response.parsed_output) {
            return { status: 'unparseable', output: null, model: response.model }
        }
        return { status: 'ok', output: response.parsed_output as z.infer<Schema>, model: response.model }
    }

    /**
     * Work through a request with tools (the SDK's tool runner calls them and feeds results back).
     *
     * @param input.instructions - System prompt.
     * @param input.prompt - The request.
     * @param input.tools - Actions the model may take.
     * @param input.maxSteps - Most model turns before stopping.
     * @returns The model's final text.
     */
    async runWithTools({
        instructions,
        prompt,
        tools,
        maxSteps = 12,
    }: {
        instructions: string
        prompt: string
        tools: AiTool[]
        maxSteps?: number
    }) {
        const message = await this.client.beta.messages.toolRunner({
            model: this.model,
            max_tokens: 8000,
            max_iterations: maxSteps,
            system: instructions,
            output_config: { effort: 'medium' },
            tools: tools.map(tool =>
                betaZodTool({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    run: input => tool.run(input as never),
                }),
            ),
            messages: [{ role: 'user', content: prompt }],
        })
        return message.content
            .flatMap(block => (block.type === 'text' ? [block.text] : []))
            .join('\n')
            .trim()
    }
}

/**
 * The configured AI provider, or null when no API key is set (email classification is then skipped).
 *
 * @returns The provider, or null.
 */
export function aiProvider(): AiProvider | null {
    return config.anthropicApiKey
        ? new AnthropicProvider({ apiKey: config.anthropicApiKey, model: config.aiModel })
        : null
}
