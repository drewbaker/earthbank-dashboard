<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ForecastEvent } from '#shared/forecast/project-runway.ts'
import { formatDate } from '~/utils/format.ts'

const props = defineProps<{ events: ForecastEvent[]; limit?: number }>()
const emit = defineEmits<{ editPlannedExpense: [plannedExpenseId: string] }>()

const isExpanded = ref(false)
const visibleEvents = computed(() =>
    isExpanded.value || !props.limit ? props.events : props.events.slice(0, props.limit),
)

const SOURCE_DETAILS: Record<ForecastEvent['source'], { label: string; icon: string }> = {
    pipeline: { label: 'Pipeline', icon: 'i-lucide-hand-coins' },
    planned_expense: { label: 'Planned', icon: 'i-lucide-receipt' },
    scenario: { label: 'Scenario', icon: 'i-lucide-flask-conical' },
}
</script>

<template>
    <div>
        <ul v-if="events.length" class="divide-y divide-default text-sm">
            <li
                v-for="(event, index) in visibleEvents"
                :key="`${event.date}-${event.label}-${index}`"
                class="flex items-start gap-3 px-4 py-2"
            >
                <UIcon :name="SOURCE_DETAILS[event.source].icon" class="mt-0.5 size-4 shrink-0 text-muted" />
                <div class="min-w-0 flex-1">
                    <button
                        v-if="event.planned_expense_id"
                        type="button"
                        class="max-w-full truncate text-left text-highlighted hover:underline"
                        :title="`Edit ${event.label}`"
                        @click="emit('editPlannedExpense', event.planned_expense_id)"
                    >
                        {{ event.label }}
                    </button>
                    <NuxtLink
                        v-else-if="event.funder_id"
                        :to="`/pipeline/funders/${event.funder_id}`"
                        class="block truncate text-highlighted hover:underline"
                    >
                        {{ event.label }}
                    </NuxtLink>
                    <p v-else class="truncate text-highlighted">{{ event.label }}</p>
                    <p class="text-xs text-muted">
                        {{ formatDate({ value: event.date }) }} · {{ SOURCE_DETAILS[event.source].label
                        }}<template v-if="event.note"> · {{ event.note }}</template>
                    </p>
                </div>
                <ForecastEventAmount :event="event" class="text-right" />
            </li>
        </ul>
        <p v-else class="px-4 py-4 text-sm text-muted">
            Nothing changes the lines yet: add expected dates to opportunities, or planned expenses.
        </p>
        <div v-if="limit && events.length > limit" class="px-4 pb-3">
            <UButton
                :label="isExpanded ? 'Show fewer' : `Show all ${events.length}`"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="isExpanded = !isExpanded"
            />
        </div>
    </div>
</template>
