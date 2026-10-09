<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useAsyncData, useToast } from '#imports'
import type { GoalType, OpportunityStage } from '#shared/constants/pipeline.ts'
import {
    APPROVAL_TO_FUNDING_DAYS,
    COMMITTEE_MIN_PROBABILITY,
    OPPORTUNITY_STAGE_DETAILS,
    OPPORTUNITY_STAGES,
} from '#shared/constants/pipeline.ts'
import type { Opportunity, StageProbabilities } from '#shared/schemas/index.ts'
import { defaultStageProbabilities, opportunityProbability } from '#shared/utils/probability.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { NO_OWNER, ownerIdFromSelection, usePipelineReference } from '~/composables/usePipelineReference.ts'
import { centsToDollars, dollarsToCents } from '~/utils/format.ts'

const props = defineProps<{
    /** Edit this opportunity; omit to create one for `funderId`. */
    opportunity?: Opportunity | null
    funderId?: string
    funderName?: string
}>()
const emit = defineEmits<{ saved: [opportunity: Opportunity] }>()
const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()
const { ownerItems, goalItems } = usePipelineReference()

// The team's probability per stage (Settings → Pipeline), so a blank override shows what it falls back to.
const { data: stageProbabilities } = useAsyncData('settings.stage-probabilities', () =>
    api<StageProbabilities>({ path: '/settings/stage-probabilities' }),
)
const stageDefault = computed(() => {
    const stage = formState.stage
    return {
        label: OPPORTUNITY_STAGE_DETAILS[stage].label,
        probability: opportunityProbability({
            stage,
            probabilityOverride: null,
            stageProbabilities: stageProbabilities.value ?? defaultStageProbabilities(),
        }),
    }
})

// Amounts are typed in dollars and sent as cents; dates come straight from date inputs (YYYY-MM-DD).
type OpportunityFormState = {
    goal_type: GoalType
    name: string
    stage: OpportunityStage
    amount_dollars: number | undefined
    probability_override: number | undefined
    expected_decision_at: string
    expected_receipt_at: string
    committee_on: string
    received_at: string
    next_step: string
    owner_id: string
}

const formState = reactive<OpportunityFormState>(emptyFormState())
const errorMessage = ref<string | null>(null)
const isSaving = ref(false)
const isEditing = computed(() => Boolean(props.opportunity))
const stageItems = OPPORTUNITY_STAGES.map(stage => ({ label: OPPORTUNITY_STAGE_DETAILS[stage].label, value: stage }))

watch(open, isOpen => {
    if (isOpen) {
        Object.assign(
            formState,
            props.opportunity ? formStateFrom({ opportunity: props.opportunity }) : emptyFormState(),
        )
        errorMessage.value = null
    }
})

/**
 * Blank form for a new opportunity.
 *
 * @returns Default form values.
 */
function emptyFormState(): OpportunityFormState {
    return {
        goal_type: 'design_grant',
        name: 'Design grant',
        stage: 'identified',
        amount_dollars: undefined,
        probability_override: undefined,
        expected_decision_at: '',
        expected_receipt_at: '',
        committee_on: '',
        received_at: '',
        next_step: '',
        owner_id: NO_OWNER,
    }
}

/**
 * Form values for an existing opportunity.
 *
 * @param input.opportunity - The opportunity being edited.
 * @returns Form values.
 */
function formStateFrom({ opportunity }: { opportunity: Opportunity }): OpportunityFormState {
    return {
        goal_type: opportunity.goal_type,
        name: opportunity.name,
        stage: opportunity.stage,
        amount_dollars: centsToDollars({ cents: opportunity.amount_cents }),
        probability_override: opportunity.probability_override ?? undefined,
        expected_decision_at: opportunity.expected_decision_at ?? '',
        expected_receipt_at: opportunity.expected_receipt_at ?? '',
        committee_on: opportunity.committee_on ?? '',
        received_at: opportunity.received_at ?? '',
        next_step: opportunity.next_step ?? '',
        owner_id: opportunity.owner?.id ?? NO_OWNER,
    }
}

/**
 * Save the opportunity (create or update) and close.
 *
 * @returns Resolves once saved, or once the error is shown.
 */
async function saveOpportunity() {
    errorMessage.value = null
    isSaving.value = true
    const fields = {
        goal_type: formState.goal_type,
        name: formState.name,
        stage: formState.stage,
        amount_cents: dollarsToCents({ dollars: formState.amount_dollars }),
        probability_override: formState.probability_override ?? null,
        expected_decision_at: formState.expected_decision_at || null,
        expected_receipt_at: formState.expected_receipt_at || null,
        committee_on: formState.committee_on || null,
        received_at: formState.received_at || null,
        next_step: formState.next_step.trim() || null,
        owner_id: ownerIdFromSelection({ ownerId: formState.owner_id }),
    }
    try {
        const saved = props.opportunity
            ? await api<Opportunity>({ path: `/opportunities/${props.opportunity.id}`, method: 'PATCH', body: fields })
            : await api<Opportunity>({
                  path: '/opportunities',
                  method: 'POST',
                  body: { ...fields, funder_id: props.funderId },
              })
        toast.add({ title: isEditing.value ? 'Opportunity updated' : 'Opportunity added', color: 'success' })
        emit('saved', saved)
        open.value = false
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error })
    } finally {
        isSaving.value = false
    }
}
</script>

<template>
    <UModal
        v-model:open="open"
        :title="isEditing ? 'Edit opportunity' : 'New opportunity'"
        :description="funderName ?? opportunity?.funder.name"
        :ui="{ content: 'max-w-2xl' }"
    >
        <template #body>
            <UForm :state="formState" class="grid gap-4 sm:grid-cols-2" @submit="saveOpportunity">
                <UFormField label="Goal" name="goal_type" required>
                    <USelect v-model="formState.goal_type" :items="goalItems" class="w-full" />
                </UFormField>
                <UFormField label="Name" name="name" required>
                    <UInput v-model="formState.name" placeholder="Design grant" class="w-full" />
                </UFormField>
                <UFormField label="Stage" name="stage" required>
                    <USelect v-model="formState.stage" :items="stageItems" class="w-full" />
                </UFormField>
                <UFormField label="Amount (USD)" name="amount_dollars">
                    <MoneyInput v-model="formState.amount_dollars" placeholder="Unknown" />
                </UFormField>
                <UFormField label="Expected decision" name="expected_decision_at">
                    <UInput v-model="formState.expected_decision_at" type="date" class="w-full" />
                </UFormField>
                <UFormField
                    v-if="formState.stage === 'in_committee' || formState.committee_on"
                    label="Went to committee"
                    name="committee_on"
                    :help="`Filled in when the stage moves to In committee; it then counts as at least ${COMMITTEE_MIN_PROBABILITY}% likely.`"
                >
                    <UInput v-model="formState.committee_on" type="date" class="w-full" />
                </UFormField>
                <UFormField
                    label="Expected to land"
                    name="expected_receipt_at"
                    :help="`Drives the runway forecast. Moving to Approved sets it ${APPROVAL_TO_FUNDING_DAYS} days out unless you give a date.`"
                >
                    <UInput v-model="formState.expected_receipt_at" type="date" class="w-full" />
                </UFormField>
                <UFormField v-if="formState.stage === 'received'" label="Received on" name="received_at">
                    <UInput v-model="formState.received_at" type="date" class="w-full" />
                </UFormField>
                <UFormField
                    label="Probability override (%)"
                    name="probability_override"
                    :help="`Leave blank to use the ${stageDefault.label} stage default: ${stageDefault.probability}%.`"
                >
                    <UInputNumber
                        v-model="formState.probability_override"
                        :min="0"
                        :max="100"
                        :placeholder="`Default: ${stageDefault.probability}%`"
                        class="w-full"
                    />
                </UFormField>
                <UFormField label="Owner" name="owner_id">
                    <USelect v-model="formState.owner_id" :items="ownerItems" class="w-full" />
                </UFormField>
                <UFormField label="Next step" name="next_step" class="sm:col-span-2">
                    <UTextarea v-model="formState.next_step" :rows="2" autoresize class="w-full" />
                </UFormField>

                <UAlert v-if="errorMessage" color="error" :description="errorMessage" class="sm:col-span-2" />

                <div class="flex justify-end gap-2 sm:col-span-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
                    <UButton
                        type="submit"
                        variant="solid"
                        :loading="isSaving"
                        :label="isEditing ? 'Save' : 'Add opportunity'"
                    />
                </div>
            </UForm>
        </template>
    </UModal>
</template>
