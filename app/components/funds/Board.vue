<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FundStage } from '#shared/constants/funds.ts'
import { FUND_FIT_TAG_LABELS, FUND_STAGES } from '#shared/constants/funds.ts'
import type { Fund } from '#shared/schemas/index.ts'
import { countryName } from '~/utils/fund-findings.ts'
import { formatMoney } from '~/utils/format.ts'

const props = defineProps<{ funds: Fund[] }>()
const emit = defineEmits<{ move: [input: { fund: Fund; stage: FundStage }] }>()

const draggedFundId = ref<string | null>(null)
const dropTargetStage = ref<FundStage | null>(null)

const columns = computed(() =>
    FUND_STAGES.map(stage => ({ stage, cards: props.funds.filter(fund => fund.stage === stage) })),
)

/**
 * Drop the dragged card into a stage column.
 *
 * @param input.stage - The column it was dropped on.
 * @returns Nothing; emits `move` when the stage changed.
 */
function dropOnStage({ stage }: { stage: FundStage }) {
    const fund = props.funds.find(candidate => candidate.id === draggedFundId.value)
    draggedFundId.value = null
    dropTargetStage.value = null
    if (fund && fund.stage !== stage) {
        emit('move', { fund, stage })
    }
}

/**
 * The check-size line on a card.
 *
 * @param input.fund - The fund.
 * @returns "$500K–$5M", or null when unknown.
 */
function checkSizeLabel({ fund }: { fund: Fund }) {
    if (fund.check_min_cents === null && fund.check_max_cents === null) {
        return null
    }
    return [fund.check_min_cents, fund.check_max_cents]
        .map(cents => formatMoney({ cents, compact: true, unknown: '?' }))
        .join('–')
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
                <FundsStageBadge :stage="column.stage" />
                <span class="text-xs text-muted">{{ column.cards.length }}</span>
            </header>
            <div class="flex min-h-24 flex-1 flex-col gap-2 p-2">
                <NuxtLink
                    v-for="card in column.cards"
                    :key="card.id"
                    :to="`/funds/${card.id}`"
                    draggable="true"
                    class="space-y-1.5 rounded-md border border-default bg-default p-3 text-left hover:border-accented"
                    @dragstart="draggedFundId = card.id"
                    @dragend="draggedFundId = null"
                >
                    <p class="font-medium text-highlighted">{{ card.name }}</p>
                    <p v-if="card.hq_country || card.hq_city" class="text-xs text-muted">
                        {{ [card.hq_city, countryName({ code: card.hq_country })].filter(Boolean).join(', ') }}
                    </p>
                    <div v-if="card.fit_tags.length" class="flex flex-wrap gap-1">
                        <UBadge
                            v-for="tag in card.fit_tags"
                            :key="tag"
                            :label="FUND_FIT_TAG_LABELS[tag]"
                            size="sm"
                            variant="outline"
                        />
                    </div>
                    <p v-if="checkSizeLabel({ fund: card })" class="text-xs text-toned">
                        {{ checkSizeLabel({ fund: card }) }}
                    </p>
                    <FundsCompletenessMeter :value="card.research_completeness" label="Research" />
                </NuxtLink>
                <p v-if="column.cards.length === 0" class="px-1 py-4 text-center text-xs text-dimmed">No funds</p>
            </div>
        </section>
    </div>
</template>
