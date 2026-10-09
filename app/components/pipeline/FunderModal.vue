<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useToast } from '#imports'
import type {
    FunderKind,
    FunderTier,
    GoalType,
    OpportunityStage,
    RelationshipStatus,
} from '#shared/constants/pipeline.ts'
import {
    FUNDER_KIND_LABELS,
    FUNDER_KINDS,
    FUNDER_TIER_DETAILS,
    FUNDER_TIERS,
    OPPORTUNITY_STAGE_DETAILS,
    OPPORTUNITY_STAGES,
    RELATIONSHIP_STATUS_DETAILS,
    RELATIONSHIP_STATUSES,
} from '#shared/constants/pipeline.ts'
import type { FunderDetail } from '#shared/schemas/index.ts'
import { emailDomain, isFreeMailDomain, normalizeEmailAddress } from '#shared/utils/email-addresses.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { NO_OWNER, ownerIdFromSelection, usePipelineReference } from '~/composables/usePipelineReference.ts'
import { dollarsToCents } from '~/utils/format.ts'

const props = defineProps<{ funder?: FunderDetail | null }>()
const emit = defineEmits<{ saved: [funder: FunderDetail] }>()
const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()
const { ownerItems, goalItems } = usePipelineReference()

// Select options can't be null; "no tier" travels as this sentinel.
const NO_TIER = 'none'

type FunderFormState = {
    name: string
    kind: FunderKind
    tier: FunderTier | typeof NO_TIER
    relationship_status: RelationshipStatus
    geo_focus: string
    potential_size: string
    email_domains: string[]
    owner_id: string
    notes: string
    contact_name: string
    contact_title: string
    contact_email: string
    add_opportunity: boolean
    opportunity_goal_type: GoalType
    opportunity_stage: OpportunityStage
    opportunity_amount_dollars: number | undefined
    opportunity_expected_receipt_at: string
}

const formState = reactive<FunderFormState>(emptyFormState())
const errorMessage = ref<string | null>(null)
const isSaving = ref(false)
const isEditing = computed(() => Boolean(props.funder))

const kindItems = FUNDER_KINDS.map(kind => ({ label: FUNDER_KIND_LABELS[kind], value: kind }))
const tierItems = [
    { label: 'No tier', value: NO_TIER },
    ...FUNDER_TIERS.map(tier => ({
        label: `${FUNDER_TIER_DETAILS[tier].label} · ${FUNDER_TIER_DETAILS[tier].description}`,
        value: tier,
    })),
]
const relationshipItems = RELATIONSHIP_STATUSES.map(status => ({
    label: RELATIONSHIP_STATUS_DETAILS[status].label,
    value: status,
}))
const stageItems = OPPORTUNITY_STAGES.map(stage => ({
    label: OPPORTUNITY_STAGE_DETAILS[stage].label,
    value: stage,
}))

watch(open, isOpen => {
    if (isOpen) {
        Object.assign(formState, props.funder ? formStateFrom({ funder: props.funder }) : emptyFormState())
        errorMessage.value = null
    }
})

// Suggest the contact's organization domain so their colleagues' mail matches this funder too.
watch(
    () => formState.contact_email,
    email => {
        const normalized = normalizeEmailAddress({ email })
        if (!normalized) {
            return
        }
        const domain = emailDomain({ email: normalized })
        if (!isFreeMailDomain({ domain }) && !formState.email_domains.includes(domain)) {
            formState.email_domains = [...formState.email_domains, domain]
        }
    },
)

/**
 * Blank form for a new funder.
 *
 * @returns Default form values.
 */
function emptyFormState(): FunderFormState {
    return {
        name: '',
        kind: 'foundation',
        tier: NO_TIER,
        relationship_status: 'early',
        geo_focus: '',
        potential_size: '',
        email_domains: [],
        owner_id: NO_OWNER,
        notes: '',
        contact_name: '',
        contact_title: '',
        contact_email: '',
        add_opportunity: true,
        opportunity_goal_type: 'design_grant',
        opportunity_stage: 'identified',
        opportunity_amount_dollars: undefined,
        opportunity_expected_receipt_at: '',
    }
}

/**
 * Form values for an existing funder.
 *
 * @param input.funder - The funder being edited.
 * @returns Form values.
 */
function formStateFrom({ funder }: { funder: FunderDetail }): FunderFormState {
    return {
        ...emptyFormState(),
        name: funder.name,
        kind: funder.kind,
        tier: funder.tier ?? NO_TIER,
        relationship_status: funder.relationship_status,
        geo_focus: funder.geo_focus ?? '',
        potential_size: funder.potential_size ?? '',
        email_domains: [...funder.email_domains],
        owner_id: funder.owner?.id ?? NO_OWNER,
        notes: funder.notes ?? '',
        add_opportunity: false,
    }
}

/**
 * Save the funder (create or update) and close.
 *
 * @returns Resolves once saved, or once the error is shown.
 */
async function saveFunder() {
    errorMessage.value = null
    isSaving.value = true
    const fields = {
        name: formState.name,
        kind: formState.kind,
        tier: formState.tier === NO_TIER ? null : formState.tier,
        relationship_status: formState.relationship_status,
        geo_focus: formState.geo_focus.trim() || null,
        potential_size: formState.potential_size.trim() || null,
        email_domains: formState.email_domains,
        owner_id: ownerIdFromSelection({ ownerId: formState.owner_id }),
        notes: formState.notes.trim() || null,
    }
    try {
        const saved = props.funder
            ? await api<FunderDetail>({ path: `/funders/${props.funder.id}`, method: 'PATCH', body: fields })
            : await api<FunderDetail>({ path: '/funders', method: 'POST', body: { ...fields, ...newFunderExtras() } })
        toast.add({
            title: isEditing.value ? 'Funder updated' : `${saved.name} added to the pipeline`,
            color: 'success',
        })
        emit('saved', saved)
        open.value = false
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error })
    } finally {
        isSaving.value = false
    }
}

/**
 * The first contact and opportunity sent with a new funder.
 *
 * @returns `{ contacts, opportunity }` for the create request.
 */
function newFunderExtras() {
    const contacts = formState.contact_name.trim()
        ? [
              {
                  name: formState.contact_name,
                  title: formState.contact_title || null,
                  email: formState.contact_email || null,
              },
          ]
        : []
    const opportunity = formState.add_opportunity
        ? {
              goal_type: formState.opportunity_goal_type,
              stage: formState.opportunity_stage,
              amount_cents: dollarsToCents({ dollars: formState.opportunity_amount_dollars }),
              expected_receipt_at: formState.opportunity_expected_receipt_at || null,
          }
        : null
    return { contacts, opportunity }
}
</script>

<template>
    <UModal
        v-model:open="open"
        :title="isEditing ? 'Edit funder' : 'New funder'"
        :description="isEditing ? funder?.name : 'Add an organization that might give or lend us money.'"
        :ui="{ content: 'max-w-2xl' }"
    >
        <template #body>
            <UForm :state="formState" class="space-y-6" @submit="saveFunder">
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField label="Organization" name="name" required class="sm:col-span-2">
                        <UInput v-model="formState.name" placeholder="IKEA Foundation" class="w-full" autofocus />
                    </UFormField>
                    <UFormField label="Kind" name="kind">
                        <USelect v-model="formState.kind" :items="kindItems" class="w-full" />
                    </UFormField>
                    <UFormField label="Relationship" name="relationship_status">
                        <USelect v-model="formState.relationship_status" :items="relationshipItems" class="w-full" />
                    </UFormField>
                    <UFormField label="Tier" name="tier">
                        <USelect v-model="formState.tier" :items="tierItems" class="w-full" />
                    </UFormField>
                    <UFormField label="Owner" name="owner_id">
                        <USelect v-model="formState.owner_id" :items="ownerItems" class="w-full" />
                    </UFormField>
                    <UFormField label="Geo focus" name="geo_focus">
                        <UInput v-model="formState.geo_focus" placeholder="Africa, India" class="w-full" />
                    </UFormField>
                    <UFormField label="Potential size" name="potential_size">
                        <UInput v-model="formState.potential_size" placeholder="Above $10M" class="w-full" />
                    </UFormField>
                    <UFormField
                        label="Email domains"
                        name="email_domains"
                        help="Mail from these domains is matched to this funder."
                        class="sm:col-span-2"
                    >
                        <UInputTags v-model="formState.email_domains" placeholder="ikeafoundation.org" class="w-full" />
                    </UFormField>
                </div>

                <template v-if="!isEditing">
                    <USeparator label="First contact (optional)" />
                    <div class="grid gap-4 sm:grid-cols-3">
                        <UFormField label="Name" name="contact_name">
                            <UInput v-model="formState.contact_name" class="w-full" />
                        </UFormField>
                        <UFormField label="Email" name="contact_email">
                            <UInput v-model="formState.contact_email" type="email" class="w-full" />
                        </UFormField>
                        <UFormField label="Title" name="contact_title">
                            <UInput v-model="formState.contact_title" class="w-full" />
                        </UFormField>
                    </div>

                    <USeparator>
                        <USwitch v-model="formState.add_opportunity" label="Add an opportunity" />
                    </USeparator>
                    <div v-if="formState.add_opportunity" class="grid gap-4 sm:grid-cols-2">
                        <UFormField label="Goal" name="opportunity_goal_type">
                            <USelect v-model="formState.opportunity_goal_type" :items="goalItems" class="w-full" />
                        </UFormField>
                        <UFormField label="Stage" name="opportunity_stage">
                            <USelect v-model="formState.opportunity_stage" :items="stageItems" class="w-full" />
                        </UFormField>
                        <UFormField label="Amount (USD)" name="opportunity_amount_dollars">
                            <UInputNumber
                                v-model="formState.opportunity_amount_dollars"
                                :min="0"
                                :step="1000"
                                :format-options="{ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }"
                                placeholder="Unknown"
                                class="w-full"
                            />
                        </UFormField>
                        <UFormField label="Expected to land" name="opportunity_expected_receipt_at">
                            <UInput v-model="formState.opportunity_expected_receipt_at" type="date" class="w-full" />
                        </UFormField>
                    </div>
                </template>

                <UFormField label="Notes" name="notes">
                    <UTextarea v-model="formState.notes" :rows="3" autoresize class="w-full" />
                </UFormField>

                <UAlert v-if="errorMessage" color="error" :description="errorMessage" />

                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
                    <UButton
                        type="submit"
                        variant="solid"
                        :loading="isSaving"
                        :label="isEditing ? 'Save' : 'Add funder'"
                    />
                </div>
            </UForm>
        </template>
    </UModal>
</template>
