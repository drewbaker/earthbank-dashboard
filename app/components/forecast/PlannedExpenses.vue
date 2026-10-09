<script setup lang="ts">
import { ref } from 'vue'
import { useAsyncData, useToast } from '#imports'
import type { PlannedExpense, PlannedExpenseList } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatDate, formatMoney } from '~/utils/format.ts'

const props = defineProps<{ today: string }>()
const emit = defineEmits<{ changed: [] }>()

const api = useApi()
const toast = useToast()
const { data: plannedExpenses, refresh } = await useAsyncData('forecast.planned-expenses', () =>
    api<PlannedExpenseList>({ path: '/planned-expenses' }),
)

const isModalOpen = ref(false)
const editingExpense = ref<PlannedExpense | null>(null)
const removingId = ref<string | null>(null)

/**
 * Open the form for a new planned expense or an existing one.
 *
 * @param input.plannedExpense - The expense to edit, or null for a new one.
 * @returns Nothing.
 */
function openForm({ plannedExpense }: { plannedExpense: PlannedExpense | null }) {
    editingExpense.value = plannedExpense
    isModalOpen.value = true
}

/**
 * Reload the list and tell the page the forecast inputs changed.
 *
 * @returns Resolves once reloaded.
 */
async function reload() {
    await refresh()
    emit('changed')
}

/**
 * Take a planned expense out of the forecast.
 *
 * @param input.plannedExpense - The expense.
 * @returns Resolves once removed.
 */
async function removeExpense({ plannedExpense }: { plannedExpense: PlannedExpense }) {
    removingId.value = plannedExpense.id
    try {
        await api({ path: `/planned-expenses/${plannedExpense.id}`, method: 'DELETE' })
        toast.add({ title: `${plannedExpense.label} removed from the forecast`, color: 'success' })
        await reload()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        removingId.value = null
    }
}

/**
 * When and how much, e.g. "$200K on Mar 1, 2027" or "$8K/month from Jan 1, 2027 to Dec 31, 2027".
 *
 * @param input.plannedExpense - The expense.
 * @returns The description.
 */
function describeExpense({ plannedExpense }: { plannedExpense: PlannedExpense }) {
    const amount = formatMoney({ cents: plannedExpense.amount_cents, compact: true })
    if (plannedExpense.kind === 'one_off') {
        return `${amount} on ${formatDate({ value: plannedExpense.starts_on })}`
    }
    const until = plannedExpense.ends_on ? ` to ${formatDate({ value: plannedExpense.ends_on })}` : ', ongoing'
    return `${amount}/month from ${formatDate({ value: plannedExpense.starts_on })}${until}`
}

defineExpose({ openForm })
</script>

<template>
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
            <div class="flex items-center justify-between gap-2">
                <div>
                    <h2 class="font-medium text-highlighted">Planned expenses</h2>
                    <p class="text-xs text-muted">Spending you've decided on, included in both lines.</p>
                </div>
                <UButton size="sm" icon="i-lucide-plus" label="Add" @click="openForm({ plannedExpense: null })" />
            </div>
        </template>
        <ul v-if="plannedExpenses?.data.length" class="divide-y divide-default text-sm">
            <li
                v-for="plannedExpense in plannedExpenses.data"
                :key="plannedExpense.id"
                class="flex items-center gap-3 px-4 py-2"
            >
                <UIcon
                    :name="plannedExpense.kind === 'monthly' ? 'i-lucide-repeat' : 'i-lucide-receipt'"
                    class="size-4 shrink-0 text-muted"
                />
                <button type="button" class="min-w-0 flex-1 text-left" @click="openForm({ plannedExpense })">
                    <p class="truncate text-highlighted">{{ plannedExpense.label }}</p>
                    <p class="text-xs text-muted">{{ describeExpense({ plannedExpense }) }}</p>
                </button>
                <UButton
                    icon="i-lucide-pencil"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :aria-label="`Edit ${plannedExpense.label}`"
                    @click="openForm({ plannedExpense })"
                />
                <UButton
                    icon="i-lucide-trash-2"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :loading="removingId === plannedExpense.id"
                    :aria-label="`Remove ${plannedExpense.label}`"
                    @click="removeExpense({ plannedExpense })"
                />
            </li>
        </ul>
        <p v-else class="px-4 py-4 text-sm text-muted">
            None yet. Add decisions like a market research study or a new contract, so the runway reflects them.
        </p>
        <ForecastPlannedExpenseModal
            v-model:open="isModalOpen"
            :planned-expense="editingExpense"
            :today="props.today"
            @saved="reload"
        />
    </UCard>
</template>
