import { computed } from 'vue'
import { useAsyncData } from '#imports'
import type { MilestoneList, OpportunityList } from '#shared/schemas/index.ts'
import { useApi } from '~/composables/useApi.ts'
import { formatDate } from '~/utils/format.ts'

// Select options can't use null; "none" travels as this sentinel in task and milestone forms.
export const NO_LINK = 'none'

/**
 * Turn a form's link selection into the API value.
 *
 * @param input.value - Selected value (`NO_LINK` or an id).
 * @returns The id, or null.
 */
export function linkIdFromSelection({ value }: { value: string }) {
    return value === NO_LINK ? null : value
}

/**
 * Milestones and opportunities as select options for task and milestone forms.
 *
 * @returns Select items, plus refreshers.
 */
export function useTaskReference() {
    const api = useApi()
    const milestones = useAsyncData('reference.milestones', () => api<MilestoneList>({ path: '/milestones' }))
    const opportunities = useAsyncData('reference.opportunities', () =>
        api<OpportunityList>({ path: '/opportunities', query: { include_closed: true, limit: 500 } }),
    )

    const milestoneItems = computed(() => [
        { label: 'No milestone', value: NO_LINK },
        ...(milestones.data.value?.data ?? []).map(milestone => ({
            label: `${milestone.title} · ${formatDate({ value: milestone.due_at, style: 'short' })}`,
            value: milestone.id,
        })),
    ])

    const opportunityItems = computed(() => [
        { label: 'No opportunity', value: NO_LINK },
        ...(opportunities.data.value?.data ?? [])
            .filter(opportunity => opportunity.stage !== 'lost')
            .map(opportunity => ({ label: `${opportunity.funder.name} · ${opportunity.name}`, value: opportunity.id })),
    ])

    return { milestones, opportunities, milestoneItems, opportunityItems }
}
