import { APPROVAL_TO_FUNDING_DAYS } from '#shared/constants/pipeline.ts'
import { addDays } from '#shared/utils/calendar-dates.ts'

export type StageRuleChange = { field: 'expected_receipt_at' | 'committee_on'; value: string; reason: string }

/**
 * Dates that follow from a stage change:
 * - Approved: the money is expected `APPROVAL_TO_FUNDING_DAYS` after approval, replacing any
 *   earlier guess, unless the same change set the expected date itself (a known date wins).
 * - In committee: record the day it went to committee, unless one is already recorded or given.
 *
 * @param input.fromStage - Stage before the change.
 * @param input.toStage - Stage after it.
 * @param input.on - The day the change happened (today, or the email's date).
 * @param input.hasCommitteeDate - Whether a committee date is already recorded.
 * @param input.explicitFields - Fields the same change already sets.
 * @returns Further changes to apply, each with its reason.
 */
export function stageRuleChanges({
    fromStage,
    toStage,
    on,
    hasCommitteeDate,
    explicitFields,
}: {
    fromStage: string | null
    toStage: string
    on: string
    hasCommitteeDate: boolean
    explicitFields: Set<string>
}): StageRuleChange[] {
    if (fromStage === toStage) {
        return []
    }
    const changes: StageRuleChange[] = []
    const isNewlyApproved = toStage === 'committed' && fromStage !== 'received'
    if (isNewlyApproved && !explicitFields.has('expected_receipt_at')) {
        changes.push({
            field: 'expected_receipt_at',
            value: addDays({ value: on, days: APPROVAL_TO_FUNDING_DAYS }),
            reason: `Approved on ${on}; funding is expected ${APPROVAL_TO_FUNDING_DAYS} days after approval.`,
        })
    }
    if (toStage === 'in_committee' && !hasCommitteeDate && !explicitFields.has('committee_on')) {
        changes.push({ field: 'committee_on', value: on, reason: `Went to committee on ${on}.` })
    }
    return changes
}
