import { computed } from 'vue'
import { useAsyncData } from '#imports'
import { GOAL_TYPE_DETAILS, GOAL_TYPES } from '#shared/constants/pipeline.ts'
import type { GoalList, UserList } from '#shared/schemas/index.ts'
import { useApi } from '~/composables/useApi.ts'

// Select options can't use null or '' as a value, so "no owner" travels as this sentinel in forms.
export const NO_OWNER = 'unassigned'

/**
 * Turn a form's owner selection into the API value.
 *
 * @param input.ownerId - Selected value (`NO_OWNER` or a user id).
 * @returns The user id, or null.
 */
export function ownerIdFromSelection({ ownerId }: { ownerId: string }) {
    return ownerId === NO_OWNER ? null : ownerId
}

/**
 * Team members and goals, shared by every pipeline form (loaded once, cached by key).
 *
 * @returns Select items for owners and goals, plus the raw lists and refreshers.
 */
export function usePipelineReference() {
    const api = useApi()
    const team = useAsyncData('reference.team', () => api<UserList>({ path: '/users' }))
    const goals = useAsyncData('reference.goals', () => api<GoalList>({ path: '/goals' }))

    const ownerItems = computed(() => [
        { label: 'No owner', value: NO_OWNER },
        ...(team.data.value?.data ?? [])
            .filter(user => !user.deactivated_at)
            .map(user => ({
                label: user.name,
                value: user.id,
                avatar: { src: user.avatar_url ?? undefined, alt: user.name },
            })),
    ])

    const goalItems = GOAL_TYPES.map(type => ({ label: GOAL_TYPE_DETAILS[type].label, value: type }))

    const goalTypeById = computed(
        () => new Map((goals.data.value?.data ?? []).map(goal => [goal.id, goal.type] as const)),
    )

    return { team, goals, ownerItems, goalItems, goalTypeById }
}
