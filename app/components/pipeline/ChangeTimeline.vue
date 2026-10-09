<script setup lang="ts">
import { computed } from 'vue'
import { CHANGE_SOURCE_LABELS } from '#shared/constants/pipeline.ts'
import type { ChangeEvent } from '#shared/schemas/index.ts'
import { usePipelineReference } from '~/composables/usePipelineReference.ts'
import { changeFieldLabel, formatChangeValue } from '~/utils/change-values.ts'
import { formatRelativeTime } from '~/utils/format.ts'

defineProps<{ events: ChangeEvent[]; showEntityName?: boolean; busyEventId?: string | null }>()
const emit = defineEmits<{
    revert: [event: ChangeEvent]
    accept: [event: ChangeEvent]
    reject: [event: ChangeEvent]
}>()

const { team, goalTypeById } = usePipelineReference()

const lookups = computed(() => ({
    userNames: new Map((team.data.value?.data ?? []).map(user => [user.id, user.name] as const)),
    goalTypeById: goalTypeById.value,
}))

const SOURCE_ICONS: Record<ChangeEvent['source'], string> = {
    manual: 'i-lucide-pencil',
    import: 'i-lucide-file-spreadsheet',
    ai_email: 'i-lucide-sparkles',
    ai_forward: 'i-lucide-forward',
}

const STATUS_BADGES: Record<ChangeEvent['status'], { label: string; color: 'warning' | 'neutral' | 'error' } | null> = {
    applied: null,
    pending: { label: 'Needs review', color: 'warning' },
    rejected: { label: 'Rejected', color: 'neutral' },
    reverted: { label: 'Reverted', color: 'error' },
}
</script>

<template>
    <ol class="divide-y divide-default">
        <li v-for="event in events" :key="event.id" class="flex gap-3 py-3">
            <UIcon :name="SOURCE_ICONS[event.source]" class="mt-0.5 size-4 shrink-0 text-muted" />
            <div class="min-w-0 flex-1 space-y-1">
                <p class="text-sm">
                    <template v-if="showEntityName && event.funder_id">
                        <NuxtLink
                            :to="`/pipeline/funders/${event.funder_id}`"
                            class="font-medium text-highlighted hover:underline"
                        >
                            {{ event.entity_name }}
                        </NuxtLink>
                        ·
                    </template>
                    <template v-else-if="event.entity_type === 'opportunity' && event.entity_name">
                        <span class="text-muted">{{ event.entity_name.split(' · ').at(-1) }}:</span>
                        {{ ' ' }}
                    </template>
                    <span class="font-medium text-highlighted">{{ changeFieldLabel({ field: event.field }) }}</span>
                    {{ ' ' }}
                    <span class="text-muted">{{
                        formatChangeValue({ field: event.field, value: event.from_value, lookups })
                    }}</span>
                    <span class="text-muted"> → </span>
                    <span class="text-highlighted">{{
                        formatChangeValue({ field: event.field, value: event.to_value, lookups })
                    }}</span>
                    <UBadge
                        v-if="STATUS_BADGES[event.status]"
                        :label="STATUS_BADGES[event.status]!.label"
                        :color="STATUS_BADGES[event.status]!.color"
                        size="sm"
                        class="ml-2"
                    />
                </p>
                <p v-if="event.reason" class="text-xs text-muted">{{ event.reason }}</p>
                <p class="text-xs text-dimmed">
                    {{ CHANGE_SOURCE_LABELS[event.source] }}
                    <template v-if="event.actor"> by {{ event.actor.name }}</template>
                    <template v-if="event.confidence !== null">
                        · {{ Math.round(event.confidence * 100) }}% confident</template
                    >
                    · {{ formatRelativeTime({ value: event.created_at }) }}
                </p>
                <slot name="evidence" :event="event" />
            </div>
            <div class="flex shrink-0 items-start gap-1">
                <template v-if="event.status === 'pending'">
                    <UButton
                        size="xs"
                        color="success"
                        label="Accept"
                        :loading="busyEventId === event.id"
                        @click="emit('accept', event)"
                    />
                    <UButton size="xs" color="neutral" variant="ghost" label="Reject" @click="emit('reject', event)" />
                </template>
                <UButton
                    v-else-if="event.status === 'applied'"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-undo-2"
                    label="Revert"
                    :loading="busyEventId === event.id"
                    @click="emit('revert', event)"
                />
            </div>
        </li>
    </ol>
</template>
