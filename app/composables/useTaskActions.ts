import { ref } from 'vue'
import { useToast } from '#imports'
import type { Task } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'

/**
 * Quick task actions shared by every task list.
 *
 * @param input.onChanged - Called after a successful change (usually a refresh).
 * @returns `toggleDone` and the id of the task being updated.
 */
export function useTaskActions({ onChanged }: { onChanged: () => Promise<unknown> | unknown }) {
    const api = useApi()
    const toast = useToast()
    const updatingTaskId = ref<string | null>(null)

    /**
     * Mark a task done, or reopen a done task.
     *
     * @param task - The task.
     * @returns Resolves once saved and refreshed.
     */
    async function toggleDone(task: Task) {
        updatingTaskId.value = task.id
        try {
            await api({
                path: `/tasks/${task.id}`,
                method: 'PATCH',
                body: { status: task.status === 'done' ? 'todo' : 'done' },
            })
            await onChanged()
        } catch (error) {
            toast.add({ title: apiErrorMessage({ error }), color: 'error' })
        } finally {
            updatingTaskId.value = null
        }
    }

    return { updatingTaskId, toggleDone }
}
