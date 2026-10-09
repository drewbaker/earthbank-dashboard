<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { ScenarioAdjustment } from '#shared/schemas/index.ts'
import { ScenarioAdjustment as ScenarioAdjustmentSchema } from '#shared/schemas/index.ts'
import type { AdjustmentKind } from '~/utils/scenario-descriptions.ts'
import { ADJUSTMENT_KIND_DETAILS } from '~/utils/scenario-descriptions.ts'
import { dollarsToCents } from '~/utils/format.ts'

const props = defineProps<{
    opportunities: { id: string; label: string }[]
    plannedExpenses: { id: string; label: string }[]
    today: string
}>()
const emit = defineEmits<{ add: [adjustment: ScenarioAdjustment] }>()

const kind = ref<AdjustmentKind>('shift_receipt')
const fields = reactive({
    opportunity_id: '',
    planned_expense_id: '',
    months: 3,
    amount_dollars: undefined as number | undefined,
    probability: 50,
    label: '',
    monthly_dollars: undefined as number | undefined,
    starts_at: '',
    ends_at: '',
    one_off_direction: 'cost' as 'cost' | 'income',
    at: '',
    pct: 10,
})
const errorMessage = ref<string | null>(null)

const kindItems = Object.entries(ADJUSTMENT_KIND_DETAILS).map(([value, details]) => ({
    label: details.label,
    value,
    icon: details.icon,
}))
const needsOpportunity = computed(() =>
    ['shift_receipt', 'change_amount', 'change_probability', 'exclude_opportunity'].includes(kind.value),
)
const opportunityItems = computed(() =>
    props.opportunities.map(opportunity => ({ label: opportunity.label, value: opportunity.id })),
)
const plannedExpenseItems = computed(() =>
    props.plannedExpenses.map(expense => ({ label: expense.label, value: expense.id })),
)

/**
 * Build the adjustment from the form, validate it with the shared schema and emit it.
 *
 * @returns Nothing; shows an error when the form is incomplete.
 */
function addAdjustment() {
    errorMessage.value = null
    const parsed = ScenarioAdjustmentSchema.safeParse(buildAdjustment())
    if (!parsed.success) {
        errorMessage.value =
            needsOpportunity.value && !fields.opportunity_id
                ? 'Choose an opportunity.'
                : kind.value === 'exclude_planned_expense' && !fields.planned_expense_id
                  ? 'Choose a planned expense.'
                  : 'Fill in every field.'
        return
    }
    emit('add', parsed.data)
    fields.label = ''
}

/**
 * The adjustment described by the form (not yet validated).
 *
 * @returns An adjustment-shaped object.
 */
function buildAdjustment() {
    const startsAt = fields.starts_at || props.today
    switch (kind.value) {
        case 'shift_receipt':
            return { kind: kind.value, opportunity_id: fields.opportunity_id, months: fields.months }
        case 'change_amount':
            return {
                kind: kind.value,
                opportunity_id: fields.opportunity_id,
                amount_cents: dollarsToCents({ dollars: fields.amount_dollars }),
            }
        case 'change_probability':
            return { kind: kind.value, opportunity_id: fields.opportunity_id, probability: fields.probability }
        case 'exclude_opportunity':
            return { kind: kind.value, opportunity_id: fields.opportunity_id }
        case 'add_recurring_cost':
            return {
                kind: kind.value,
                label: fields.label || 'New hire',
                monthly_cents: dollarsToCents({ dollars: fields.monthly_dollars }),
                starts_at: startsAt,
                ends_at: fields.ends_at || null,
            }
        case 'add_one_off': {
            const cents = dollarsToCents({ dollars: fields.amount_dollars }) ?? Number.NaN
            return {
                kind: kind.value,
                label: fields.label || (fields.one_off_direction === 'cost' ? 'One-off cost' : 'One-off income'),
                amount_cents: fields.one_off_direction === 'cost' ? -cents : cents,
                at: fields.at || props.today,
            }
        }
        case 'change_burn_pct':
            return { kind: kind.value, pct: fields.pct, starts_at: startsAt }
        case 'exclude_planned_expense':
            return { kind: kind.value, planned_expense_id: fields.planned_expense_id }
    }
}
</script>

<template>
    <div class="space-y-3">
        <UFormField label="What if…">
            <USelect v-model="kind" :items="kindItems" class="w-full" />
        </UFormField>

        <UFormField v-if="needsOpportunity" label="Opportunity">
            <USelectMenu
                v-model="fields.opportunity_id"
                :items="opportunityItems"
                value-key="value"
                placeholder="Choose…"
                class="w-full"
            />
        </UFormField>

        <UFormField v-if="kind === 'exclude_planned_expense'" label="Planned expense">
            <USelectMenu
                v-model="fields.planned_expense_id"
                :items="plannedExpenseItems"
                value-key="value"
                placeholder="Choose…"
                class="w-full"
            />
        </UFormField>

        <UFormField
            v-if="kind === 'shift_receipt'"
            :label="`Slips by ${fields.months} month${fields.months === 1 ? '' : 's'}`"
        >
            <USlider v-model="fields.months" :min="-6" :max="12" :step="1" />
        </UFormField>

        <UFormField v-if="kind === 'change_amount'" label="New amount (USD)">
            <UInputNumber
                v-model="fields.amount_dollars"
                :min="0"
                :step="50000"
                :format-options="{ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }"
                class="w-full"
            />
        </UFormField>

        <UFormField v-if="kind === 'change_probability'" :label="`Probability: ${fields.probability}%`">
            <USlider v-model="fields.probability" :min="0" :max="100" :step="5" />
        </UFormField>

        <template v-if="kind === 'add_recurring_cost'">
            <UFormField label="Label">
                <UInput v-model="fields.label" placeholder="Head of Partnerships" class="w-full" />
            </UFormField>
            <UFormField label="Monthly cost, fully loaded (USD)">
                <UInputNumber
                    v-model="fields.monthly_dollars"
                    :min="0"
                    :step="1000"
                    :format-options="{ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }"
                    class="w-full"
                />
            </UFormField>
            <div class="grid grid-cols-2 gap-2">
                <UFormField label="Starts">
                    <UInput v-model="fields.starts_at" type="date" class="w-full" />
                </UFormField>
                <UFormField label="Ends (optional)">
                    <UInput v-model="fields.ends_at" type="date" class="w-full" />
                </UFormField>
            </div>
        </template>

        <template v-if="kind === 'add_one_off'">
            <URadioGroup
                v-model="fields.one_off_direction"
                orientation="horizontal"
                :items="[
                    { label: 'Cost', value: 'cost' },
                    { label: 'Income', value: 'income' },
                ]"
            />
            <UFormField label="Label">
                <UInput v-model="fields.label" placeholder="Annual audit" class="w-full" />
            </UFormField>
            <div class="grid grid-cols-2 gap-2">
                <UFormField label="Amount (USD)">
                    <UInputNumber
                        v-model="fields.amount_dollars"
                        :min="0"
                        :step="1000"
                        :format-options="{ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }"
                        class="w-full"
                    />
                </UFormField>
                <UFormField label="Date">
                    <UInput v-model="fields.at" type="date" class="w-full" />
                </UFormField>
            </div>
        </template>

        <template v-if="kind === 'change_burn_pct'">
            <UFormField :label="`Burn ${fields.pct >= 0 ? 'up' : 'down'} ${Math.abs(fields.pct)}%`">
                <USlider v-model="fields.pct" :min="-50" :max="100" :step="5" />
            </UFormField>
            <UFormField label="From">
                <UInput v-model="fields.starts_at" type="date" class="w-full" />
            </UFormField>
        </template>

        <UAlert v-if="errorMessage" color="error" :description="errorMessage" />
        <UButton icon="i-lucide-plus" label="Add to scenario" block @click="addAdjustment" />
    </div>
</template>
