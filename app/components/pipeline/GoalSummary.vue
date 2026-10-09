<script setup lang="ts">
import { GOAL_TYPE_DETAILS } from '#shared/constants/pipeline.ts'
import type { Goal } from '#shared/schemas/index.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'

defineProps<{ goals: Goal[] }>()

/**
 * Share of a goal's target that is secured (committed + received).
 *
 * @param input.goal - The goal.
 * @returns 0–100, or null when there's no target.
 */
function securedPercent({ goal }: { goal: Goal }) {
    if (!goal.target_amount_cents) {
        return null
    }
    const secured = goal.totals.committed_cents + goal.totals.received_cents
    return Math.min(100, Math.round((secured / goal.target_amount_cents) * 100))
}
</script>

<template>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UCard v-for="goal in goals" :key="goal.id" :ui="{ body: 'space-y-3' }">
            <div class="flex items-start justify-between gap-2">
                <div>
                    <p class="font-medium text-highlighted">{{ goal.name }}</p>
                    <p class="text-xs text-muted">{{ GOAL_TYPE_DETAILS[goal.type].description }}</p>
                </div>
                <UBadge
                    :color="GOAL_TYPE_DETAILS[goal.type].color"
                    :label="`${goal.totals.opportunity_count}`"
                    size="sm"
                />
            </div>

            <div>
                <p class="text-2xl font-semibold text-highlighted">
                    {{
                        formatMoney({ cents: goal.totals.committed_cents + goal.totals.received_cents, compact: true })
                    }}
                    <span class="text-sm font-normal text-muted">secured</span>
                </p>
                <p v-if="goal.target_amount_cents" class="text-xs text-muted">
                    of {{ formatMoney({ cents: goal.target_amount_cents, compact: true }) }} target
                    <template v-if="goal.target_date">by {{ formatDate({ value: goal.target_date }) }}</template>
                </p>
                <p v-else class="text-xs text-muted">No target set</p>
            </div>

            <UProgress
                v-if="securedPercent({ goal }) !== null"
                :model-value="securedPercent({ goal })"
                :color="GOAL_TYPE_DETAILS[goal.type].color"
                size="sm"
            />

            <dl class="grid grid-cols-2 gap-2 text-sm">
                <div>
                    <dt class="text-muted">Weighted pipeline</dt>
                    <dd class="font-medium text-highlighted">
                        {{ formatMoney({ cents: goal.totals.weighted_open_cents, compact: true }) }}
                    </dd>
                </div>
                <div>
                    <dt class="text-muted">Open asks</dt>
                    <dd class="font-medium text-highlighted">
                        {{ formatMoney({ cents: goal.totals.open_amount_cents, compact: true }) }}
                    </dd>
                </div>
            </dl>
        </UCard>
    </div>
</template>
