<script setup lang="ts">
import { TASK_STATUS_DETAILS } from '#shared/constants/pipeline.ts'
import type { Task } from '#shared/schemas/index.ts'
import { formatDate } from '~/utils/format.ts'

defineProps<{ task: Task; showMilestone?: boolean; hideAssignee?: boolean; isUpdating?: boolean }>()
const emit = defineEmits<{ open: [task: Task]; toggleDone: [task: Task] }>()
</script>

<template>
    <div class="group flex items-center gap-3 px-3 py-2 hover:bg-elevated/50">
        <UButton
            :icon="TASK_STATUS_DETAILS[task.status].icon"
            :color="task.status === 'done' ? 'success' : task.status === 'doing' ? 'info' : 'neutral'"
            variant="ghost"
            size="sm"
            square
            :loading="isUpdating"
            :aria-label="task.status === 'done' ? 'Mark not done' : 'Mark done'"
            @click="emit('toggleDone', task)"
        />
        <button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="emit('open', task)">
            <div class="min-w-0 flex-1">
                <p
                    class="truncate text-sm"
                    :class="task.status === 'done' ? 'text-muted line-through' : 'text-highlighted'"
                >
                    {{ task.title }}
                </p>
                <p v-if="(showMilestone && task.milestone) || task.opportunity" class="truncate text-xs text-muted">
                    <template v-if="showMilestone && task.milestone">{{ task.milestone.title }}</template>
                    <template v-if="showMilestone && task.milestone && task.opportunity"> · </template>
                    <template v-if="task.opportunity">{{ task.opportunity.funder.name }}</template>
                </p>
            </div>
            <span v-if="task.comment_count" class="flex items-center gap-1 text-xs text-muted">
                <UIcon name="i-lucide-message-square" class="size-3.5" />{{ task.comment_count }}
            </span>
            <span v-if="task.attachment_count" class="flex items-center gap-1 text-xs text-muted">
                <UIcon name="i-lucide-paperclip" class="size-3.5" />{{ task.attachment_count }}
            </span>
            <span
                v-if="task.due_at"
                class="text-xs whitespace-nowrap"
                :class="task.is_overdue ? 'font-medium text-error' : 'text-muted'"
            >
                {{ task.is_overdue ? 'Overdue · ' : '' }}{{ formatDate({ value: task.due_at, style: 'short' }) }}
            </span>
            <UAvatar
                v-if="!hideAssignee"
                :src="task.assignee?.avatar_url ?? undefined"
                :alt="task.assignee?.name ?? 'Unassigned'"
                :icon="task.assignee ? undefined : 'i-lucide-user-round'"
                size="2xs"
            />
        </button>
    </div>
</template>
