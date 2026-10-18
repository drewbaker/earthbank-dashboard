<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CashSummary } from '#shared/schemas/index.ts'
import { formatMoney } from '~/utils/format.ts'

const props = defineProps<{ cash: CashSummary | null | undefined }>()

const isOpen = ref(false)
const expenseGroups = computed(() => props.cash?.expense_groups ?? [])
const canExpand = computed(() => expenseGroups.value.length > 0)
const groupTotalCents = computed(() => expenseGroups.value.reduce((sum, group) => sum + group.monthly_cents, 0))
const lookbackMonths = computed(() => props.cash?.burn_by_month.length ?? 0)

/**
 * Open or close the breakdown, when there is one to show.
 *
 * @returns Nothing.
 */
function toggleBreakdown() {
    if (canExpand.value) {
        isOpen.value = !isOpen.value
    }
}

/**
 * A group's share of the breakdown total, for its bar.
 *
 * @param input.cents - The group's monthly average.
 * @returns A CSS width, e.g. `42%`.
 */
function shareWidth({ cents }: { cents: number }) {
    return `${groupTotalCents.value > 0 ? Math.round((cents / groupTotalCents.value) * 100) : 0}%`
}
</script>

<template>
    <UCard :class="canExpand && 'cursor-pointer'" @click="toggleBreakdown">
        <div class="flex items-start justify-between gap-2">
            <p class="text-sm text-muted">Monthly burn<TermHint term="monthly_burn" /></p>
            <UButton
                v-if="canExpand"
                :icon="isOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                :aria-label="isOpen ? 'Hide spending by category' : 'Show spending by category'"
                :aria-expanded="isOpen"
                size="xs"
                color="neutral"
                variant="ghost"
                class="-my-1 -mr-1"
                @click.stop="toggleBreakdown"
            />
        </div>
        <p class="mt-1 text-3xl font-semibold text-highlighted">
            {{ formatMoney({ cents: cash?.monthly_burn_cents, compact: true, unknown: 'Not set' }) }}
        </p>
        <p class="mt-1 text-xs text-muted">
            {{
                cash?.burn_source === 'override'
                    ? 'Set by hand'
                    : cash?.burn_source === 'computed'
                      ? 'Average of recent months'
                      : 'No spending history yet'
            }}
        </p>

        <UCollapsible v-if="canExpand" v-model:open="isOpen">
            <template #content>
                <div class="mt-4 space-y-3 border-t border-default pt-4">
                    <p class="text-xs text-muted">
                        Monthly average by category over the last {{ lookbackMonths }} full months<template
                            v-if="cash?.burn_source === 'override'"
                        >
                            (synced spending: {{ formatMoney({ cents: cash.computed_burn_cents }) }}/mo)</template
                        >.
                    </p>
                    <ul class="space-y-2.5">
                        <li v-for="group in expenseGroups" :key="group.name" class="text-sm">
                            <div class="flex justify-between gap-2">
                                <span class="truncate text-default">{{ group.name }}</span>
                                <span class="shrink-0 font-medium text-highlighted tabular-nums">
                                    {{ formatMoney({ cents: group.monthly_cents }) }}
                                </span>
                            </div>
                            <div class="mt-1 h-1 rounded-full bg-elevated">
                                <div
                                    class="h-1 rounded-full bg-primary"
                                    :style="{ width: shareWidth({ cents: group.monthly_cents }) }"
                                />
                            </div>
                        </li>
                    </ul>
                </div>
            </template>
        </UCollapsible>
    </UCard>
</template>
