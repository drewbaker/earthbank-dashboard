import { z } from 'zod'
import { countActiveFundManagers, findFundManagerByIdentity } from '#server/database/fund-managers.ts'
import {
    createFundResearchRun,
    finishFundResearchRun,
    listUnclassifiedOrganizations,
    markOrganizationClassified,
} from '#server/database/fund-research.ts'
import type { AiProvider } from '#server/utils/ai/provider.ts'
import { CLASSIFY_LENDERS_INSTRUCTIONS } from '#server/utils/ai/instructions.ts'
import { researchCostMicroUsd } from '#server/utils/ai/web-research.ts'
import { addFund } from '#server/utils/funds/add-fund.ts'
import { readFundResearchSettings, readMonthResearchSpend } from '#server/utils/funds/research-settings.ts'
import type { FundOrigin, ResearchOrganizationKind } from '#shared/constants/funds.ts'
import { RESEARCH_ORGANIZATION_KINDS } from '#shared/constants/funds.ts'
import { organizationNameKey, websiteDomain } from '#shared/funds/organization-names.ts'

/** Something the spider might add: an organization from a person's work history, a lender the AI named, or a public-list recipient. */
export type LenderCandidate =
    | { type: 'organization'; organizationId: string }
    | { type: 'named'; name: string; website: string | null; context: string }
    | { type: 'public_record'; name: string; context: string }

const LenderClassification = z.object({
    organizations: z.array(
        z.object({
            name: z.string(),
            is_lender: z.boolean(),
            kind: z.enum(RESEARCH_ORGANIZATION_KINDS),
        }),
    ),
})

// Organizations of these kinds (as the researcher labelled them) are never lenders to research.
const NEVER_LENDER_KINDS: readonly ResearchOrganizationKind[] = ['school', 'government', 'dfi']
const CLASSIFY_BATCH_SIZE = 25

type ResolvedCandidate = {
    name: string
    nameKey: string
    website: string | null
    context: string
    origin: FundOrigin
    organizationId: string | null
}

/**
 * Add the lenders among some candidates to the list and queue their research (the spider).
 *
 * Stops when the spider is turned off, the list reaches its limit, or this month's budget is spent.
 * Candidates already on the list are skipped; the rest are checked by a cheap model call (is this a
 * lender to SMEs or projects?), and only lenders become fund profiles. Everyone else stays a node in
 * the team network.
 *
 * @param input.candidates - What to consider.
 * @param input.discoveredFromId - The fund (if any) whose research produced them.
 * @param input.classifier - Model that decides which candidates are lenders.
 * @param input.now - Current time.
 * @returns How many funds were added.
 */
export async function discoverLenders({
    candidates,
    discoveredFromId,
    classifier,
    now,
}: {
    candidates: LenderCandidate[]
    discoveredFromId: string | null
    classifier: AiProvider
    now: Date
}) {
    const settings = await readFundResearchSettings()
    if (!settings.spider_enabled || candidates.length === 0) {
        return 0
    }
    const room = settings.max_funds - (await countActiveFundManagers())
    if (room <= 0 || (await readMonthResearchSpend({ settings, now })).isOverBudget) {
        return 0
    }

    const resolved = await resolveCandidates({ candidates })
    const fresh: ResolvedCandidate[] = []
    for (const candidate of resolved) {
        const existing = await findFundManagerByIdentity({
            nameKey: candidate.nameKey,
            websiteDomain: websiteDomain({ url: candidate.website }),
        })
        if (existing) {
            if (candidate.organizationId) {
                await markOrganizationClassified({
                    organizationId: candidate.organizationId,
                    kind: 'lender',
                    fundManagerId: existing.id,
                    now,
                })
            }
            continue
        }
        fresh.push(candidate)
    }

    let added = 0
    for (let start = 0; start < fresh.length && added < room; start += CLASSIFY_BATCH_SIZE) {
        const batch = fresh.slice(start, start + CLASSIFY_BATCH_SIZE)
        const verdicts = await classifyCandidates({ batch, classifier, discoveredFromId, now })
        for (const candidate of batch) {
            const verdict = verdicts.get(candidate.nameKey)
            const isLender = verdict?.is_lender === true && added < room
            let fundManagerId: string | null = null
            if (isLender) {
                const { fund, isNew } = await addFund({
                    name: candidate.name,
                    websiteUrl: candidate.website,
                    origin: candidate.origin,
                    discoveredFromId,
                    now,
                })
                fundManagerId = fund.id
                added += isNew ? 1 : 0
            }
            if (candidate.organizationId) {
                await markOrganizationClassified({
                    organizationId: candidate.organizationId,
                    kind: isLender ? 'lender' : (verdict?.kind ?? 'other'),
                    fundManagerId,
                    now,
                })
            }
        }
    }
    return added
}

/**
 * Turn candidates into names with context, dropping organizations already classified or never lenders.
 *
 * @param input.candidates - Raw candidates.
 * @returns Unique candidates by name key.
 */
async function resolveCandidates({ candidates }: { candidates: LenderCandidate[] }) {
    const organizationIds = candidates.flatMap(candidate =>
        candidate.type === 'organization' ? [candidate.organizationId] : [],
    )
    const organizations = organizationIds.length > 0 ? await listUnclassifiedOrganizations({ organizationIds }) : []
    const byKey = new Map<string, ResolvedCandidate>()
    for (const organization of organizations) {
        if (NEVER_LENDER_KINDS.includes(organization.kind as ResearchOrganizationKind)) {
            continue
        }
        byKey.set(organization.name_key, {
            name: organization.name,
            nameKey: organization.name_key,
            website: organization.website_domain,
            context: "a team member's past or current employer",
            origin: 'spider_person',
            organizationId: organization.id,
        })
    }
    for (const candidate of candidates) {
        if (candidate.type === 'organization') {
            continue
        }
        const nameKey = organizationNameKey({ name: candidate.name })
        if (nameKey && !byKey.has(nameKey)) {
            byKey.set(nameKey, {
                name: candidate.name,
                nameKey,
                website: candidate.type === 'named' ? candidate.website : null,
                context: candidate.context,
                origin: candidate.type === 'named' ? 'spider_suggestion' : 'spider_public_record',
                organizationId: null,
            })
        }
    }
    return [...byKey.values()]
}

/**
 * Ask the model which candidates are lenders, and record what it cost.
 *
 * @param input.batch - Up to 25 candidates.
 * @param input.classifier - The model.
 * @param input.discoveredFromId - The fund that led here (for the cost record).
 * @param input.now - Current time.
 * @returns Verdicts by name key (missing when the model refused).
 */
async function classifyCandidates({
    batch,
    classifier,
    discoveredFromId,
    now,
}: {
    batch: ResolvedCandidate[]
    classifier: AiProvider
    discoveredFromId: string | null
    now: Date
}) {
    const run = await createFundResearchRun({
        kind: 'classification',
        fundManagerId: discoveredFromId,
        model: classifier.model,
        now,
    })
    const result = await classifier.completeStructured({
        instructions: CLASSIFY_LENDERS_INSTRUCTIONS,
        prompt: batch
            .map(
                candidate =>
                    `- ${candidate.name}${candidate.website ? ` (${candidate.website})` : ''}: came up as ${candidate.context}`,
            )
            .join('\n'),
        schema: LenderClassification,
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
    const verdicts = new Map<string, z.infer<typeof LenderClassification>['organizations'][number]>()
    for (const organization of result.output?.organizations ?? []) {
        verdicts.set(organizationNameKey({ name: organization.name }), organization)
    }
    return verdicts
}
