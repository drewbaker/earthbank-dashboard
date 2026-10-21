import { z } from 'zod'
import { listFundsWithUncheckedNames, storeFundDisplayName } from '#server/database/fund-managers.ts'
import { createFundResearchRun, finishFundResearchRun } from '#server/database/fund-research.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { TIDY_FUND_NAMES_INSTRUCTIONS } from '#server/utils/ai/instructions.ts'
import { researchCostMicroUsd } from '#server/utils/ai/web-research.ts'
import { organizationNameKey, tidyOrganizationName } from '#shared/funds/organization-names.ts'

const TidiedNames = z.object({ names: z.array(z.object({ original: z.string(), display_name: z.string() })) })

const NAME_BATCH_SIZE = 50

/**
 * The name to show for an organization, given a tidied name the AI proposed.
 *
 * The AI may only change capitalization and drop legal forms: its name is used only when it means
 * the same organization as the original (the same name key, which ignores case, punctuation and legal
 * forms). Otherwise, or with no proposal, the original is tidied in code.
 *
 * @param input.original - The name as found.
 * @param input.proposed - The AI's display name, if any.
 * @returns The display name.
 */
export function acceptedDisplayName({ original, proposed }: { original: string; proposed: string | null | undefined }) {
    const tidyProposal = proposed ? tidyOrganizationName({ name: proposed }) : ''
    if (tidyProposal && organizationNameKey({ name: tidyProposal }) === organizationNameKey({ name: original })) {
        return tidyProposal
    }
    return tidyOrganizationName({ name: original })
}

/**
 * Tidy the names of funds added before names were checked (all capitals from government lists, legal
 * forms at the end), with a cheap model call per 50 names, or in code alone without one. Each fund is
 * checked once; its name key, which tells funds apart, never changes.
 *
 * @param input.classifier - The model, or null to tidy in code only.
 * @param input.now - Current time.
 * @returns How many names were checked and how many changed.
 */
export async function checkFundNames({ classifier, now }: { classifier: AiProvider | null; now: Date }) {
    const funds = await listFundsWithUncheckedNames({ limit: NAME_BATCH_SIZE * 4 })
    let checked = 0
    let renamed = 0
    for (let start = 0; start < funds.length; start += NAME_BATCH_SIZE) {
        const batch = funds.slice(start, start + NAME_BATCH_SIZE)
        const proposals = classifier ? await proposeDisplayNames({ batch, classifier, now }) : new Map<string, string>()
        if (classifier && proposals.size === 0) {
            // The model refused or failed; try again on the next run.
            continue
        }
        for (const fund of batch) {
            const name = acceptedDisplayName({ original: fund.name, proposed: proposals.get(fund.name) })
            await storeFundDisplayName({ fundManagerId: fund.id, name, now })
            checked += 1
            renamed += name === fund.name ? 0 : 1
        }
    }
    return { checked, renamed }
}

/**
 * Ask the model for tidy display names, and record what it cost.
 *
 * @param input.batch - Up to 50 funds (name and website).
 * @param input.classifier - The model.
 * @param input.now - Current time.
 * @returns Proposed display name by original name.
 */
async function proposeDisplayNames({
    batch,
    classifier,
    now,
}: {
    batch: { name: string; website_url: string | null }[]
    classifier: AiProvider
    now: Date
}) {
    const run = await createFundResearchRun({ kind: 'classification', model: classifier.model, now })
    const result = await classifier.completeStructured({
        instructions: TIDY_FUND_NAMES_INSTRUCTIONS,
        prompt: batch.map(fund => `- ${fund.name}${fund.website_url ? ` (${fund.website_url})` : ''}`).join('\n'),
        schema: TidiedNames,
        effort: 'low',
    })
    await finishFundResearchRun({
        researchRunId: run.id,
        data: {
            status: result.status === 'ok' ? 'done' : 'failed',
            finished_at: new Date(),
            input_tokens: result.usage?.inputTokens ?? 0,
            output_tokens: result.usage?.outputTokens ?? 0,
            cost_micro_usd: researchCostMicroUsd({
                model: result.model,
                inputTokens: result.usage?.inputTokens ?? 0,
                outputTokens: result.usage?.outputTokens ?? 0,
                webSearches: 0,
            }),
            error: result.status === 'ok' ? null : result.status,
        },
    })
    return new Map((result.output?.names ?? []).map(entry => [entry.original.trim(), entry.display_name]))
}
