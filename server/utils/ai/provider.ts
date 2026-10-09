import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { z } from 'zod'
import { config } from '#server/utils/config.ts'

export type StructuredResult<Output> =
    { status: 'ok'; output: Output; model: string } | { status: 'refused' | 'unparseable'; output: null; model: string }

export interface AiProvider {
    name: string
    model: string
    completeStructured<Schema extends z.ZodType>(input: {
        instructions: string
        prompt: string
        schema: Schema
    }): Promise<StructuredResult<z.infer<Schema>>>
}

/**
 * Claude via the Anthropic API, returning output that matches a zod schema (structured outputs).
 *
 * Refusal fallbacks are on: if the model declines, the API retries on a fallback model in the same
 * call. Thinking stays adaptive; effort is kept low because classification is a short, well-defined task.
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
     * @param input.prompt - The user message (email and context).
     * @param input.schema - zod schema the answer must match.
     * @returns The parsed output, or a refused/unparseable status.
     */
    async completeStructured<Schema extends z.ZodType>({
        instructions,
        prompt,
        schema,
    }: {
        instructions: string
        prompt: string
        schema: Schema
    }): Promise<StructuredResult<z.infer<Schema>>> {
        const response = await this.client.beta.messages.parse({
            model: this.model,
            max_tokens: 4096,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: instructions,
            output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
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
