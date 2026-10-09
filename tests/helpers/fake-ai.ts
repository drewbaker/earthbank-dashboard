import type { z } from 'zod'
import type { AiProvider, StructuredResult } from '#server/utils/ai/provider.ts'

/**
 * An AI provider that returns canned answers and records every prompt it was sent.
 *
 * @param input.answers - Answers returned in order (null simulates a refusal).
 * @returns The provider and the prompts it received.
 */
export function fakeAi({ answers }: { answers: unknown[] }) {
    const prompts: string[] = []
    const provider: AiProvider = {
        name: 'fake',
        model: 'fake-model',
        async completeStructured<Schema extends z.ZodType>({
            prompt,
            schema,
        }: {
            instructions: string
            prompt: string
            schema: Schema
        }) {
            prompts.push(prompt)
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
    return { provider, prompts }
}
