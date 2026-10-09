<script setup lang="ts">
import type { SortableEvent } from 'sortablejs'
import { moveArrayElement, useSortable } from '@vueuse/integrations/useSortable'
import { ref, useTemplateRef, watch } from 'vue'
import type { Task } from '#shared/schemas/index.ts'

const props = defineProps<{ tasks: Task[]; updatingTaskId?: string | null }>()
const emit = defineEmits<{ open: [task: Task]; toggleDone: [task: Task]; reorder: [taskIds: string[]] }>()

// A local copy so a dropped row stays put while the new order saves.
const orderedTasks = ref<Task[]>([...props.tasks])
watch(
    () => props.tasks,
    tasks => {
        orderedTasks.value = [...tasks]
    },
)

const listElement = useTemplateRef<HTMLElement>('list')
useSortable(listElement, orderedTasks, {
    handle: '.task-row__drag-handle',
    animation: 150,
    // Touch devices start a drag only after a short press, so scrolling still works.
    delay: 150,
    delayOnTouchOnly: true,
    onUpdate: saveNewOrder,
})

/**
 * Move the dropped task in the local list and ask the page to save the order.
 *
 * Sortable's `onUpdate` callback, so it takes the event shape Sortable gives it.
 *
 * @param event - Where the task was dragged from and to.
 * @returns Nothing.
 */
function saveNewOrder(event: SortableEvent) {
    const from = event.oldIndex ?? 0
    const to = event.newIndex ?? 0
    const taskIds = orderedTasks.value.map(task => task.id)
    const [movedId] = taskIds.splice(from, 1)
    taskIds.splice(to, 0, movedId!)
    moveArrayElement(orderedTasks, from, to, event)
    emit('reorder', taskIds)
}
</script>

<template>
    <div ref="list" class="divide-y divide-default">
        <TasksRow
            v-for="task in orderedTasks"
            :key="task.id"
            :task="task"
            is-draggable
            :is-updating="updatingTaskId === task.id"
            @open="emit('open', $event)"
            @toggle-done="emit('toggleDone', $event)"
        />
    </div>
</template>
