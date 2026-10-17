import type { FundResearchField } from '#shared/constants/funds.ts'
import {
    FUND_DILIGENCE_QUESTIONS,
    FUND_RESEARCH_FIELD_DETAILS,
    FUND_RESEARCH_FIELDS,
    FUND_TEAM_COMPLETENESS,
} from '#shared/constants/funds.ts'

/**
 * How much of the research profile is filled in, weighted by how much each field matters for ranking.
 *
 * @param input.filledFields - Fields with at least one active finding.
 * @param input.hasPrincipals - Whether at least one principal is known.
 * @param input.hasWorkHistory - Whether any team member's past employers or schools are known.
 * @returns 0–100.
 */
export function researchCompleteness({
    filledFields,
    hasPrincipals,
    hasWorkHistory,
}: {
    filledFields: Iterable<FundResearchField>
    hasPrincipals: boolean
    hasWorkHistory: boolean
}) {
    const filled = new Set(filledFields)
    let total = FUND_TEAM_COMPLETENESS.principals + FUND_TEAM_COMPLETENESS.work_history
    let earned =
        (hasPrincipals ? FUND_TEAM_COMPLETENESS.principals : 0) +
        (hasWorkHistory ? FUND_TEAM_COMPLETENESS.work_history : 0)
    for (const field of FUND_RESEARCH_FIELDS) {
        const { weight } = FUND_RESEARCH_FIELD_DETAILS[field]
        total += weight
        if (filled.has(field)) {
            earned += weight
        }
    }
    return Math.round((earned / total) * 100)
}

/**
 * How many of the Due Diligence questions have an answer (from a person or the AI).
 *
 * @param input.answeredCount - Questions with an answer.
 * @returns 0–100.
 */
export function diligenceCompleteness({ answeredCount }: { answeredCount: number }) {
    return Math.round(
        (Math.min(answeredCount, FUND_DILIGENCE_QUESTIONS.length) / FUND_DILIGENCE_QUESTIONS.length) * 100,
    )
}
