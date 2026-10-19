import { z } from 'zod'
import {
    countActiveFundManagers,
    findFundManagerByIdentity,
    listTeamFundDecisions,
    listUnscreenedPendingFunds,
    recordFundScreening,
} from '#server/database/fund-managers.ts'
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
            scope: z.enum(['local', 'state_or_province', 'national', 'multi_country', 'global', 'unknown']),
            impact_focus: z.enum(['climate', 'impact', 'general', 'unknown']),
            fits_earth_bank: z.boolean(),
            reason: z.string(),
        }),
    ),
})

// Organizations of these kinds (as the researcher labelled them) are never lenders to research.
const NEVER_LENDER_KINDS: readonly ResearchOrganizationKind[] = ['school', 'government', 'dfi']
const CLASSIFY_BATCH_SIZE = 25
// How many of the team's recent approvals and archivals the classifier sees as examples.
const TEAM_DECISION_EXAMPLES = 15
const SCREENING_NOTE_MAX_LENGTH = 300

type LenderVerdict = z.infer<typeof LenderClassification>['organizations'][number]

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
 * lender to SMEs or projects, and does it fit Earth Bank: climate or impact focus, beyond one town or
 * state?), with the team's recent approve/archive decisions as examples. Lenders that fit become
 * pending funds; lenders that don't are added archived with the model's reason, so the team can
 * review and restore them. Everyone else stays a node in the team network.
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
                    discoveryContext: candidate.context,
                    origin: candidate.origin,
                    discoveredFromId,
                    screening: screeningFromVerdict({ verdict }),
                    now,
                })
                fundManagerId = fund.id
                // Funds screened out go in archived, so they don't use up room on the list.
                added += isNew && verdict.fits_earth_bank ? 1 : 0
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
 * Screen pending funds that were found before the screen existed (or whose screen failed), archiving
 * the ones that aren't lenders or don't fit Earth Bank. Runs from the hourly research task; each fund
 * is screened once.
 *
 * @param input.classifier - The model.
 * @param input.now - Current time.
 * @returns How many funds were screened and how many of them were archived.
 */
export async function screenPendingFunds({ classifier, now }: { classifier: AiProvider; now: Date }) {
    const settings = await readFundResearchSettings()
    if ((await readMonthResearchSpend({ settings, now })).isOverBudget) {
        return { screened: 0, archived: 0 }
    }
    const funds = await listUnscreenedPendingFunds({ limit: CLASSIFY_BATCH_SIZE * 4 })
    let screened = 0
    let archived = 0
    for (let start = 0; start < funds.length; start += CLASSIFY_BATCH_SIZE) {
        const batch = funds.slice(start, start + CLASSIFY_BATCH_SIZE).map(fund => ({
            fundManagerId: fund.id,
            name: fund.name,
            nameKey: fund.name_key,
            website: fund.website_url,
            context: fund.discovery_context ?? 'a lender the spider found',
        }))
        const verdicts = await classifyCandidates({ batch, classifier, discoveredFromId: null, now })
        if (verdicts.size === 0) {
            // The model refused or failed; try again next hour.
            continue
        }
        for (const candidate of batch) {
            const verdict = verdicts.get(candidate.nameKey)
            if (!verdict) {
                continue
            }
            // Something the screen says isn't a lender at all doesn't belong on the list either.
            const fitsEarthBank = verdict.is_lender && verdict.fits_earth_bank
            await recordFundScreening({
                fundManagerId: candidate.fundManagerId,
                note: screeningFromVerdict({ verdict }).note,
                isScreenedOut: !fitsEarthBank,
                now,
            })
            screened += 1
            archived += fitsEarthBank ? 0 : 1
        }
    }
    return { screened, archived }
}

/**
 * The screening result addFund stores for a lender, from the model's verdict.
 *
 * @param input.verdict - The model's verdict on one organization.
 * @returns The note to keep and whether the lender fits Earth Bank.
 */
function screeningFromVerdict({ verdict }: { verdict: LenderVerdict }) {
    const note = verdict.reason.trim().slice(0, SCREENING_NOTE_MAX_LENGTH) || null
    return { note, fitsEarthBank: verdict.fits_earth_bank }
}

/**
 * The team's recent approve and archive decisions on spider finds, as prompt text for the classifier.
 *
 * @returns A block of examples, or an empty string before the team has decided anything.
 */
async function teamDecisionExamples() {
    const { approved, archived } = await listTeamFundDecisions({ limit: TEAM_DECISION_EXAMPLES })
    if (approved.length === 0 && archived.length === 0) {
        return ''
    }
    const describe = (fund: { name: string; discovery_context: string | null }) =>
        `- ${fund.name}${fund.discovery_context ? `: came up as ${fund.discovery_context}` : ''}`
    return [
        "The team's recent decisions on lenders the spider found (follow their judgment for similar organizations):",
        approved.length ? `Approved for research:\n${approved.map(describe).join('\n')}` : '',
        archived.length ? `Archived as outside Earth Bank's focus:\n${archived.map(describe).join('\n')}` : '',
        '',
        'Organizations to classify:',
    ]
        .filter(line => line !== '')
        .join('\n\n')
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
    batch: { name: string; website: string | null; context: string }[]
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
        prompt: [
            await teamDecisionExamples(),
            batch
                .map(
                    candidate =>
                        `- ${candidate.name}${candidate.website ? ` (${candidate.website})` : ''}: came up as ${candidate.context}`,
                )
                .join('\n'),
        ]
            .filter(Boolean)
            .join('\n\n'),
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
    const verdicts = new Map<string, LenderVerdict>()
    for (const organization of result.output?.organizations ?? []) {
        verdicts.set(organizationNameKey({ name: organization.name }), organization)
    }
    return verdicts
}
