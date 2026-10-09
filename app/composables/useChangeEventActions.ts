import { ref } from 'vue'
import { useToast } from '#imports'
import type { ChangeEvent } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'

/**
 * Accept, reject or revert change-log entries, then let the page reload.
 *
 * @param input.onChanged - Called after any successful action (usually a refresh).
 * @returns The action functions and the id of the event being worked on.
 */
export function useChangeEventActions({ onChanged }: { onChanged: () => Promise<unknown> | unknown }) {
    const api = useApi()
    const toast = useToast()
    const busyEventId = ref<string | null>(null)

    /**
     * Run one action against a change event.
     *
     * @param input.event - The change event.
     * @param input.action - `accept`, `reject` or `revert`.
     * @returns Resolves once done and refreshed.
     */
    async function resolveChange({ event, action }: { event: ChangeEvent; action: 'accept' | 'reject' | 'revert' }) {
        busyEventId.value = event.id
        try {
            await api({ path: `/change-events/${event.id}/${action}`, method: 'POST' })
            toast.add({
                title: { accept: 'Change applied', reject: 'Suggestion rejected', revert: 'Change reverted' }[action],
                color: 'success',
            })
            await onChanged()
        } catch (error) {
            toast.add({ title: apiErrorMessage({ error }), color: 'error' })
            // The server may have retired an out-of-date suggestion; show the list as it is now.
            await onChanged()
        } finally {
            busyEventId.value = null
        }
    }

    return {
        busyEventId,
        acceptChange: (event: ChangeEvent) => resolveChange({ event, action: 'accept' }),
        rejectChange: (event: ChangeEvent) => resolveChange({ event, action: 'reject' }),
        revertChange: (event: ChangeEvent) => resolveChange({ event, action: 'revert' }),
    }
}
