<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OpportunityStage } from '#shared/constants/pipeline.ts'
import { OPPORTUNITY_STAGE_DETAILS } from '#shared/constants/pipeline.ts'
import type { Opportunity } from '#shared/schemas/index.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'

const props = defineProps<{ opportunities: Opportunity[] }>()
const emit = defineEmits<{
    move: [input: { opportunity: Opportunity; stage: OpportunityStage }]
    select: [opportunity: Opportunity]
}>()

// "Lost" is left off the board; move an opportunity there from its edit form.
const BOARD_STAGES: OpportunityStage[] = [
    'identified',
    'in_discussion',
    'proposal',
    'due_diligence',
    'committed',
    'received',
]

const draggedOpportunityId = ref<string | null>(null)
const dropTargetStage = ref<OpportunityStage | null>(null)

const columns = computed(() =>
    BOARD_STAGES.map(stage => {
        const cards = props.opportunities.filter(opportunity => opportunity.stage === stage)
        return {
            stage,
            cards,
            totalCents: cards.reduce((sum, card) => sum + (card.amount_cents ?? 0), 0),
        }
    }),
)

/**
 * Drop the dragged card into a stage column.
 *
 * @param input.stage - The column it was dropped on.
 * @returns Nothing; emits `move` when the stage changed.
 */
function dropOnStage({ stage }: { stage: OpportunityStage }) {
    const opportunity = props.opportunities.find(candidate => candidate.id === draggedOpportunityId.value)
    draggedOpportunityId.value = null
    dropTargetStage.value = null
    if (opportunity && opportunity.stage !== stage) {
        emit('move', { opportunity, stage })
    }
}
</script>

<template>
    <div class="flex gap-3 overflow-x-auto pb-2">
        <section
            v-for="column in columns"
            :key="column.stage"
            class="flex w-64 shrink-0 flex-col rounded-md border border-default bg-elevated/40"
            :class="{ 'ring-2 ring-primary': dropTargetStage === column.stage }"
            @dragover.prevent="dropTargetStage = column.stage"
            @dragleave="dropTargetStage = null"
            @drop.prevent="dropOnStage({ stage: column.stage })"
        >
            <header class="flex items-center justify-between border-b border-default px-3 py-2">
                <div class="flex items-center gap-2">
                    <PipelineStageBadge :stage="column.stage" />
                    <span class="text-xs text-muted">{{ column.cards.length }}</span>
                </div>
                <span class="text-xs font-medium text-muted">{{
                    formatMoney({ cents: column.totalCents, compact: true })
                }}</span>
            </header>
            <div class="flex min-h-24 flex-1 flex-col gap-2 p-2">
                <button
                    v-for="card in column.cards"
                    :key="card.id"
                    type="button"
                    draggable="true"
                    class="rounded-md border border-default bg-default p-3 text-left shadow-xs transition hover:border-accented"
                    :class="{ 'opacity-50': draggedOpportunityId === card.id }"
                    @dragstart="draggedOpportunityId = card.id"
                    @dragend="draggedOpportunityId = null"
                    @click="emit('select', card)"
                >
                    <p class="truncate text-sm font-medium text-highlighted">{{ card.funder.name }}</p>
                    <div class="mt-1 flex items-center justify-between gap-2">
                        <PipelineGoalBadge :goal-type="card.goal_type" />
                        <span class="text-sm text-highlighted">{{
                            formatMoney({ cents: card.amount_cents, compact: true })
                        }}</span>
                    </div>
                    <p v-if="card.expected_receipt_at" class="mt-1 text-xs text-muted">
                        Lands {{ formatDate({ value: card.expected_receipt_at }) }}
                    </p>
                </button>
                <p v-if="column.cards.length === 0" class="px-1 py-4 text-center text-xs text-dimmed">
                    Drag an opportunity here
                </p>
                <p v-else class="sr-only">{{ OPPORTUNITY_STAGE_DETAILS[column.stage].label }} column</p>
            </div>
        </section>
    </div>
</template>
