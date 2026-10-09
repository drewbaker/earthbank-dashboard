import type { z } from 'zod'
import type { AiProvider, StructuredResult } from '#server/utils/ai/provider.ts'

/**
 * An AI provider that returns canned answers and records every prompt it was sent.
 *
 * @param input.answers - Answers returned in order (null simulates a refusal).
 * @returns The provider, and the prompts and reference texts it received.
 */
export function fakeAi({ answers }: { answers: unknown[] }) {
    const prompts: string[] = []
    const references: (string | undefined)[] = []
    const provider: AiProvider = {
        name: 'fake',
        model: 'fake-model',
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
    return { provider, prompts, references }
}
