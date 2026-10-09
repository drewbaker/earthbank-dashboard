<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useAsyncData, useSeoMeta, useToast } from '#imports'
import {
    COMMITTEE_MIN_PROBABILITY,
    GOAL_TYPE_DETAILS,
    OPPORTUNITY_STAGES,
    OPPORTUNITY_STAGE_DETAILS,
} from '#shared/constants/pipeline.ts'
import type { Goal, StageProbabilities } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { usePipelineReference } from '~/composables/usePipelineReference.ts'
import { centsToDollars, dollarsToCents } from '~/utils/format.ts'

useSeoMeta({ title: 'Pipeline settings · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()
const { goals } = usePipelineReference()

const { data: stageProbabilities } = await useAsyncData('settings.stage-probabilities', () =>
    api<StageProbabilities>({ path: '/settings/stage-probabilities' }),
)

type GoalFormState = { target_dollars: number | undefined; target_date: string; notes: string }
const goalForms = reactive<Record<string, GoalFormState>>({})
const probabilityForm = reactive<Partial<StageProbabilities>>({})
const savingGoalId = ref<string | null>(null)
const isSavingProbabilities = ref(false)

watch(
    () => goals.data.value?.data,
    list => {
        for (const goal of list ?? []) {
            goalForms[goal.id] = {
                target_dollars: centsToDollars({ cents: goal.target_amount_cents }),
                target_date: goal.target_date ?? '',
                notes: goal.notes ?? '',
            }
        }
    },
    { immediate: true },
)

watch(stageProbabilities, value => Object.assign(probabilityForm, value ?? {}), { immediate: true })

/**
 * Save one goal's target.
 *
 * @param input.goal - The goal.
 * @returns Resolves once saved.
 */
async function saveGoal({ goal }: { goal: Goal }) {
    const form = goalForms[goal.id]!
    savingGoalId.value = goal.id
    try {
        await api({
            path: `/goals/${goal.id}`,
            method: 'PATCH',
            body: {
                target_amount_cents: dollarsToCents({ dollars: form.target_dollars }),
                target_date: form.target_date || null,
                notes: form.notes.trim() || null,
            },
        })
        toast.add({ title: `${goal.name} target saved`, color: 'success' })
        await goals.refresh()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        savingGoalId.value = null
    }
}

/**
 * Save the stage probabilities.
 *
 * @returns Resolves once saved.
 */
async function saveProbabilities() {
    isSavingProbabilities.value = true
    try {
        await api({ path: '/settings/stage-probabilities', method: 'PUT', body: probabilityForm })
        toast.add({ title: 'Probabilities saved', color: 'success' })
        await goals.refresh()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isSavingProbabilities.value = false
    }
}
</script>

<template>
    <div class="space-y-8">
        <section class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Funding goals</h2>
                <p class="text-sm text-muted">Targets drive the progress bars on the Overview and Pipeline pages.</p>
            </div>
            <UCard v-for="goal in goals.data.value?.data ?? []" :key="goal.id">
                <div v-if="goalForms[goal.id]" class="grid gap-4 sm:grid-cols-3">
                    <div class="sm:col-span-3">
                        <p class="font-medium text-highlighted">{{ goal.name }}</p>
                        <p class="text-xs text-muted">{{ GOAL_TYPE_DETAILS[goal.type].description }}</p>
                    </div>
                    <UFormField label="Target (USD)">
                        <MoneyInput v-model="goalForms[goal.id]!.target_dollars" placeholder="No target" />
                    </UFormField>
                    <UFormField label="Target date">
                        <UInput v-model="goalForms[goal.id]!.target_date" type="date" class="w-full" />
                    </UFormField>
                    <UFormField label="Notes">
                        <UInput v-model="goalForms[goal.id]!.notes" class="w-full" />
                    </UFormField>
                    <div class="flex justify-end sm:col-span-3">
                        <UButton label="Save" :loading="savingGoalId === goal.id" @click="saveGoal({ goal })" />
                    </div>
                </div>
            </UCard>
        </section>

        <section class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Stage probabilities</h2>
                <p class="text-sm text-muted">
                    The chance an opportunity at each stage lands. Weighted totals and the forecast's weighted line use
                    these; any opportunity can override its own.
                </p>
            </div>
            <UCard>
                <div class="grid gap-4 sm:grid-cols-4">
                    <UFormField
                        v-for="stage in OPPORTUNITY_STAGES"
                        :key="stage"
                        :label="`${OPPORTUNITY_STAGE_DETAILS[stage].label} (%)`"
                    >
                        <UInputNumber
                            v-model="probabilityForm[stage]"
                            :min="stage === 'in_committee' ? COMMITTEE_MIN_PROBABILITY : 0"
                            :max="100"
                            :step="5"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <div class="mt-4 flex justify-end">
                    <UButton label="Save probabilities" :loading="isSavingProbabilities" @click="saveProbabilities" />
                </div>
            </UCard>
        </section>
    </div>
</template>
