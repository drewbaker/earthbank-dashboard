<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '#imports'
import {
    CHANGE_SOURCE_LABELS,
    OPPORTUNITY_STAGE_DETAILS,
    OPPORTUNITY_STAGES,
    RELATIONSHIP_STATUS_DETAILS,
    RELATIONSHIP_STATUSES,
} from '#shared/constants/pipeline.ts'
import type { ChangeEvent } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { useAuth } from '~/composables/useAuth.ts'
import { usePipelineReference } from '~/composables/usePipelineReference.ts'
import { changeFieldLabel, formatChangeValue } from '~/utils/change-values.ts'
import { formatDate, formatRelativeTime } from '~/utils/format.ts'

const props = defineProps<{ event: ChangeEvent; isBusy: boolean }>()
const emit = defineEmits<{
    accept: [event: ChangeEvent]
    reject: [event: ChangeEvent]
    revert: [event: ChangeEvent]
    edited: []
}>()

const api = useApi()
const toast = useToast()
const { team, goalTypeById } = usePipelineReference()
const { currentUser } = useAuth()

const lookups = computed(() => ({
    userNames: new Map((team.data.value?.data ?? []).map(user => [user.id, user.name] as const)),
    goalTypeById: goalTypeById.value,
}))

const fieldLabel = computed(() => changeFieldLabel({ field: props.event.field }))
const currentText = computed(() =>
    formatChangeValue({
        field: props.event.field,
        value: props.event.from_value,
        lookups: lookups.value,
        isFullText: true,
    }),
)
const suggestedText = computed(() =>
    formatChangeValue({
        field: props.event.field,
        value: props.event.to_value,
        lookups: lookups.value,
        isFullText: true,
    }),
)

// The email behind the change: whose inbox it came from, and who it was between. Only that person
// gets "Open in Gmail" (the server leaves the link out for everyone else).
const evidence = computed(() => props.event.evidence)
const mailboxOwner = computed(() => evidence.value?.mailbox_user ?? null)
const isViewersMailbox = computed(() => Boolean(mailboxOwner.value && mailboxOwner.value.id === currentUser.value?.id))
const mailboxLabel = computed(() => {
    if (!mailboxOwner.value) return 'From an email'
    const owner = isViewersMailbox.value ? 'your' : `${mailboxOwner.value.name}'s`
    return evidence.value?.source === 'forward'
        ? `Forwarded by ${isViewersMailbox.value ? 'you' : mailboxOwner.value.name}`
        : `From ${owner} Gmail`
})
const emailParties = computed(() => {
    if (!evidence.value) return ''
    const owner = isViewersMailbox.value ? 'you' : (mailboxOwner.value?.name.split(' ')[0] ?? 'Earth Bank')
    const other = evidence.value.counterpart ?? evidence.value.from_address
    return evidence.value.direction === 'sent' ? `${owner} → ${other}` : `${other} → ${owner}`
})
const ownerInitials = computed(() =>
    (mailboxOwner.value?.name ?? '?')
        .split(/\s+/)
        .map(part => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
)

const isPending = computed(() => props.event.status === 'pending')
const isSaved = computed(() => props.event.status === 'applied')

// The card's question while it waits for review, and its outcome afterwards.
const STATUS_DETAILS: Record<
    Exclude<ChangeEvent['status'], 'pending'>,
    { title: string; badge: string; color: 'success' | 'neutral' | 'warning' | 'error'; icon: string }
> = {
    applied: { title: 'updated', badge: 'Saved', color: 'success', icon: 'i-lucide-check' },
    rejected: { title: 'kept as it was', badge: 'Kept current', color: 'neutral', icon: 'i-lucide-x' },
    reverted: { title: 'changed back', badge: 'Reverted', color: 'error', icon: 'i-lucide-undo-2' },
    superseded: { title: 'not changed', badge: 'Out of date', color: 'neutral', icon: 'i-lucide-clock' },
}
// Who saved it: whoever accepted the suggestion, else whoever made the change, else where it came from.
const savedBy = computed(
    () =>
        props.event.resolved_by?.name ??
        props.event.actor?.name ??
        lowercaseSourceLabel({ label: CHANGE_SOURCE_LABELS[props.event.source] }),
)

/**
 * A source label to read mid-sentence ("by import"), keeping "AI" in capitals.
 *
 * @param input.label - e.g. "AI from email", "Import".
 * @returns e.g. "AI from email", "import".
 */
function lowercaseSourceLabel({ label }: { label: string }) {
    return label.startsWith('AI') ? label : label.charAt(0).toLowerCase() + label.slice(1)
}

// Why a suggestion that wasn't applied ended up that way.
const OUTCOME_NOTES: Partial<Record<ChangeEvent['status'], string>> = {
    superseded: 'A newer email or edit changed this field, so the suggestion was retired.',
    rejected: 'The current value was kept.',
    reverted: 'This was changed back.',
}

const outcome = computed(() => (props.event.status === 'pending' ? null : STATUS_DETAILS[props.event.status]))

// AI suggestions read "Now / Suggested"; everything else is a record of what changed.
const isSuggestion = computed(() => props.event.source.startsWith('ai_') && props.event.source !== 'ai_instruction')
const beforeLabel = computed(() => (isPending.value ? 'Now' : 'Before'))
const afterLabel = computed(() => {
    if (isPending.value || !isSaved.value) return isSuggestion.value ? 'Suggested' : 'After'
    return 'Saved'
})

// How each field can be edited by hand before saving; fields not listed can only be accepted or kept.
type EditorKind = 'text' | 'money' | 'date' | 'stage' | 'relationship'
const editorKind = computed<EditorKind | null>(() => {
    const field = props.event.field
    if (field === 'stage') return 'stage'
    if (field === 'relationship_status') return 'relationship'
    if (field === 'amount_cents') return 'money'
    if (field.endsWith('_at') || field === 'committee_on') return 'date'
    if (['next_step', 'notes', 'last_contact_note', 'name'].includes(field)) return 'text'
    return null
})

const stageItems = OPPORTUNITY_STAGES.map(stage => ({
    label: OPPORTUNITY_STAGE_DETAILS[stage].label,
    value: stage as string,
}))
const relationshipItems = RELATIONSHIP_STATUSES.map(status => ({
    label: RELATIONSHIP_STATUS_DETAILS[status].label,
    value: status as string,
}))

const isEditing = ref(false)
const isSaving = ref(false)
const draftText = ref('')
const draftDollars = ref<number | undefined>(undefined)

/**
 * Open the editor with the suggested value filled in.
 *
 * @returns Nothing.
 */
function startEditing() {
    // Start from the value the field holds now: the suggestion while pending or once saved, else the old one.
    const value = isPending.value || isSaved.value ? props.event.to_value : props.event.from_value
    if (editorKind.value === 'money') {
        draftDollars.value = typeof value === 'number' ? value / 100 : undefined
    } else {
        draftText.value = value === null || value === undefined ? '' : String(value)
    }
    isEditing.value = true
}

/**
 * Save the edited value as a normal edit by hand. The suggestion then drops off the list on its own:
 * a newer change to the same field makes it out of date.
 *
 * @returns Resolves once saved and the page is told to reload.
 */
async function saveEdit() {
    const value =
        editorKind.value === 'money'
            ? draftDollars.value === undefined
                ? null
                : Math.round(draftDollars.value * 100)
            : draftText.value.trim() || null
    const path =
        props.event.entity_type === 'funder'
            ? `/funders/${props.event.entity_id}`
            : `/opportunities/${props.event.entity_id}`
    isSaving.value = true
    try {
        await api({ path, method: 'PATCH', body: { [props.event.field]: value } })
        toast.add({ title: `${fieldLabel.value} saved`, color: 'success' })
        isEditing.value = false
        emit('edited')
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isSaving.value = false
    }
}
</script>

<template>
    <article class="space-y-3 py-4">
        <div class="flex items-start justify-between gap-3">
            <div>
                <NuxtLink
                    v-if="event.funder_id"
                    :to="`/pipeline/funders/${event.funder_id}`"
                    class="text-sm text-muted hover:underline"
                >
                    {{ event.entity_name }}
                </NuxtLink>
                <p class="font-medium text-highlighted">
                    <template v-if="outcome">{{ fieldLabel }} {{ outcome.title }}</template>
                    <template v-else>Update the {{ fieldLabel.toLowerCase() }}?</template>
                </p>
            </div>
            <UBadge
                v-if="outcome"
                :label="outcome.badge"
                :color="outcome.color"
                :icon="outcome.icon"
                variant="subtle"
                class="shrink-0"
            />
        </div>

        <div v-if="evidence" class="flex items-start gap-3 rounded-md border border-default p-3">
            <UAvatar
                :src="mailboxOwner?.avatar_url ?? undefined"
                :text="ownerInitials"
                :alt="mailboxOwner?.name"
                size="sm"
                class="shrink-0"
            />
            <div class="min-w-0 flex-1 text-sm">
                <p>
                    <span class="font-medium text-highlighted">{{ mailboxLabel }}</span>
                    <span class="text-muted">
                        · {{ emailParties }} · {{ formatDate({ value: evidence.sent_at }) }}</span
                    >
                </p>
                <p v-if="evidence.subject" class="truncate text-toned">{{ evidence.subject }}</p>
                <p v-if="mailboxOwner && !isViewersMailbox" class="mt-1 flex items-center gap-1 text-xs text-muted">
                    <UIcon name="i-lucide-lock" class="size-3.5" />
                    Only {{ mailboxOwner.name.split(' ')[0] }} can open this email
                </p>
            </div>
            <UButton
                v-if="evidence.gmail_url"
                size="sm"
                color="neutral"
                icon="i-lucide-external-link"
                label="Open in Gmail"
                :to="evidence.gmail_url"
                target="_blank"
                class="shrink-0"
            />
        </div>

        <template v-if="!isEditing">
            <!-- Each box is also its button: click the value you want. -->
            <div class="grid grid-cols-2 gap-3">
                <button
                    v-if="isPending || isSaved"
                    type="button"
                    class="rounded-md border border-default p-3 text-left hover:border-accented disabled:opacity-60"
                    :disabled="isBusy"
                    @click="isPending ? emit('reject', event) : emit('revert', event)"
                >
                    <span class="mb-1 block text-xs text-muted">{{ beforeLabel }}</span>
                    <span class="text-sm whitespace-pre-line text-toned">{{ currentText }}</span>
                </button>
                <div v-else class="rounded-md border border-default p-3">
                    <span class="mb-1 block text-xs text-muted">{{ beforeLabel }}</span>
                    <span class="text-sm whitespace-pre-line text-toned">{{ currentText }}</span>
                </div>

                <button
                    v-if="isPending"
                    type="button"
                    class="rounded-md border border-success/50 bg-success/10 p-3 text-left hover:border-success disabled:opacity-60"
                    :disabled="isBusy"
                    @click="emit('accept', event)"
                >
                    <span class="mb-1 block text-xs text-success">{{ afterLabel }}</span>
                    <span class="text-sm whitespace-pre-line text-highlighted">{{ suggestedText }}</span>
                </button>
                <div
                    v-else
                    class="rounded-md border p-3"
                    :class="isSaved ? 'border-success bg-success/10 ring-1 ring-success' : 'border-default opacity-70'"
                >
                    <span class="mb-1 flex items-center gap-1 text-xs" :class="isSaved ? 'text-success' : 'text-muted'">
                        <UIcon v-if="isSaved" name="i-lucide-check" class="size-3.5" />
                        {{ afterLabel }}
                    </span>
                    <span
                        class="text-sm whitespace-pre-line"
                        :class="isSaved ? 'text-highlighted' : 'text-toned line-through'"
                    >
                        {{ suggestedText }}
                    </span>
                </div>
            </div>

            <div v-if="isPending" class="grid grid-cols-2 gap-3">
                <UButton block color="neutral" label="Keep current" :disabled="isBusy" @click="emit('reject', event)" />
                <UButton
                    block
                    color="success"
                    icon="i-lucide-check"
                    label="Use suggested"
                    :loading="isBusy"
                    @click="emit('accept', event)"
                />
            </div>
            <div v-else-if="isSaved" class="grid grid-cols-2 gap-3">
                <UButton
                    block
                    color="neutral"
                    icon="i-lucide-undo-2"
                    label="Change back to this"
                    :loading="isBusy"
                    @click="emit('revert', event)"
                />
                <p class="flex items-center justify-center gap-1 text-sm text-success">
                    <UIcon name="i-lucide-check" class="size-4" />
                    Saved {{ formatRelativeTime({ value: event.resolved_at ?? event.created_at }) }} by {{ savedBy }}
                </p>
            </div>
        </template>
        <div v-else class="space-y-2 rounded-md border border-default p-3">
            <p class="text-xs text-muted">{{ fieldLabel }}</p>
            <UTextarea v-if="editorKind === 'text'" v-model="draftText" autoresize :rows="2" class="w-full" />
            <MoneyInput v-else-if="editorKind === 'money'" v-model="draftDollars" />
            <UInput v-else-if="editorKind === 'date'" v-model="draftText" type="date" />
            <USelect v-else-if="editorKind === 'stage'" v-model="draftText" :items="stageItems" class="w-56" />
            <USelect
                v-else-if="editorKind === 'relationship'"
                v-model="draftText"
                :items="relationshipItems"
                class="w-56"
            />
            <div class="flex gap-2">
                <UButton label="Save" color="success" :loading="isSaving" @click="saveEdit" />
                <UButton label="Cancel" color="neutral" variant="ghost" @click="isEditing = false" />
            </div>
        </div>

        <div v-if="editorKind && !isEditing" class="flex flex-wrap gap-2">
            <UButton size="sm" color="neutral" icon="i-lucide-pencil" label="Edit" @click="startEditing" />
        </div>

        <p class="text-xs text-muted">
            {{ CHANGE_SOURCE_LABELS[event.source] }}<template v-if="event.actor"> by {{ event.actor.name }}</template> ·
            {{ formatRelativeTime({ value: event.created_at }) }}
            <template v-if="event.reason"> · Why: {{ event.reason }}</template>
            <template v-if="OUTCOME_NOTES[event.status]"> · {{ OUTCOME_NOTES[event.status] }}</template>
            <template v-if="event.confidence !== null"> · {{ Math.round(event.confidence * 100) }}% sure</template>
        </p>
    </article>
</template>
