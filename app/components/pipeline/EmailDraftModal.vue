<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useToast } from '#imports'
import type { FunderDetail, GmailDraft, MailboxStatus, ReplyDraft } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatDate } from '~/utils/format.ts'

const GENERAL = 'general'

const props = defineProps<{ funder: FunderDetail; opportunityId?: string | null }>()
const isOpen = defineModel<boolean>('open', { required: true })

const api = useApi()
const toast = useToast()

type DraftStep = 'brief' | 'review' | 'saved'
const step = ref<DraftStep>('brief')
const mailbox = ref<MailboxStatus | null>(null)
const selectedOpportunityId = ref<string>(GENERAL)
const guidance = ref('')
const draft = ref<ReplyDraft | null>(null)
const email = reactive({ to: [] as string[], cc: [] as string[], subject: '', body: '' })
const savedDraft = ref<GmailDraft | null>(null)
const isDrafting = ref(false)
const isSaving = ref(false)
const errorMessage = ref<string | null>(null)

const opportunityOptions = computed(() => [
    { label: 'General: no particular opportunity', value: GENERAL },
    ...props.funder.opportunities
        .filter(opportunity => opportunity.stage !== 'lost')
        .map(opportunity => ({ label: opportunity.name, value: opportunity.id })),
])
const selectedOpportunity = computed(
    () => props.funder.opportunities.find(opportunity => opportunity.id === selectedOpportunityId.value) ?? null,
)
const isGmailConnected = computed(() => mailbox.value?.connection?.status === 'active')
const canSaveToGmail = computed(() => Boolean(mailbox.value?.connection?.can_create_drafts))

watch(isOpen, async open => {
    if (!open) {
        return
    }
    step.value = 'brief'
    draft.value = null
    savedDraft.value = null
    errorMessage.value = null
    selectedOpportunityId.value = props.opportunityId ?? GENERAL
    guidance.value = selectedOpportunity.value?.next_step ?? ''
    mailbox.value = await api<MailboxStatus>({ path: '/mailbox' }).catch(() => null)
})

// Picking an opportunity starts the brief from its next step, unless the person already wrote one.
watch(selectedOpportunityId, (_, previousId) => {
    const previousStep = props.funder.opportunities.find(opportunity => opportunity.id === previousId)?.next_step
    if (!guidance.value.trim() || guidance.value === previousStep) {
        guidance.value = selectedOpportunity.value?.next_step ?? ''
    }
})

/**
 * Ask the AI for a draft, then show it for editing.
 *
 * @returns Resolves once the draft is shown or the error is.
 */
async function requestDraft() {
    isDrafting.value = true
    errorMessage.value = null
    try {
        const result = await api<ReplyDraft>({
            path: `/funders/${props.funder.id}/reply-draft`,
            method: 'POST',
            body: {
                opportunity_id: selectedOpportunityId.value === GENERAL ? null : selectedOpportunityId.value,
                guidance: guidance.value.trim() || null,
            },
        })
        draft.value = result
        Object.assign(email, { to: result.to, cc: result.cc, subject: result.subject, body: result.body })
        step.value = 'review'
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error, fallback: 'Could not draft the email.' })
    } finally {
        isDrafting.value = false
    }
}

/**
 * Save the edited email as a draft in the person's Gmail.
 *
 * @returns Resolves once saved or the error is shown.
 */
async function saveToGmail() {
    isSaving.value = true
    errorMessage.value = null
    try {
        savedDraft.value = await api<GmailDraft>({
            path: '/mailbox/drafts',
            method: 'POST',
            body: {
                funder_id: props.funder.id,
                to: email.to,
                cc: email.cc,
                subject: email.subject,
                body: email.body,
                gmail_thread_id: draft.value?.thread?.gmail_thread_id ?? null,
                in_reply_to: draft.value?.thread?.in_reply_to ?? null,
                references: draft.value?.thread?.references ?? null,
            },
        })
        step.value = 'saved'
    } catch (error) {
        errorMessage.value = apiErrorMessage({ error, fallback: 'Could not save the draft to Gmail.' })
    } finally {
        isSaving.value = false
    }
}

/**
 * Copy the email body, for pasting into any mail client.
 *
 * @returns Resolves once copied.
 */
async function copyBody() {
    try {
        await navigator.clipboard.writeText(email.body)
        toast.add({ title: 'Email copied', color: 'success' })
    } catch {
        toast.add({ title: 'Could not copy. Select the text and copy it instead.', color: 'error' })
    }
}
</script>

<template>
    <UModal
        v-model:open="isOpen"
        :title="`Email ${funder.name}`"
        :description="
            step === 'brief'
                ? 'AI drafts it from your latest thread with them, the pipeline and Earth Bank\'s Drive documents. You review it before anything is saved.'
                : undefined
        "
        :ui="{ content: 'sm:max-w-3xl' }"
    >
        <template #body>
            <div v-if="step === 'brief'" class="space-y-4">
                <UAlert
                    v-if="mailbox && !mailbox.is_ai_configured"
                    color="warning"
                    icon="i-lucide-triangle-alert"
                    title="AI isn't set up"
                    description="Add ANTHROPIC_API_KEY to the server to draft emails."
                />
                <UAlert
                    v-else-if="mailbox && !isGmailConnected"
                    color="warning"
                    icon="i-lucide-mail-x"
                    title="Connect your Gmail first"
                    description="The AI reads your latest thread with this funder to match its tone and answer what was asked."
                    :actions="[{ label: 'Go to Settings → Email', to: '/settings/email' }]"
                />
                <UFormField label="About" name="opportunity">
                    <USelect v-model="selectedOpportunityId" :items="opportunityOptions" class="w-full" />
                </UFormField>
                <UFormField
                    label="What should the email do?"
                    name="guidance"
                    help="Optional. E.g. “Send the 3-pager and propose a call the week of Nov 10.” Leave blank to reply to their latest message."
                >
                    <UTextarea v-model="guidance" :rows="3" autoresize class="w-full" />
                </UFormField>
            </div>

            <div v-else-if="step === 'review' && draft" class="space-y-4">
                <p class="text-sm text-muted">
                    <template v-if="draft.thread">
                        <UIcon name="i-lucide-reply" class="mr-1 inline size-4 align-text-bottom" />
                        Reply to “{{ draft.thread.subject }}” from {{ draft.thread.last_message_from }},
                        {{ formatDate({ value: draft.thread.last_message_at }) }}
                    </template>
                    <template v-else>
                        <UIcon name="i-lucide-mail-plus" class="mr-1 inline size-4 align-text-bottom" />
                        No email with them in the last year in your Gmail, so this is a new email.
                    </template>
                </p>
                <UFormField label="To" name="to">
                    <UInputTags v-model="email.to" placeholder="name@funder.org" class="w-full" />
                </UFormField>
                <UFormField label="Cc" name="cc">
                    <UInputTags v-model="email.cc" placeholder="Add people" class="w-full" />
                </UFormField>
                <UFormField label="Subject" name="subject">
                    <UInput v-model="email.subject" class="w-full" />
                </UFormField>
                <UFormField label="Email" name="body">
                    <UTextarea v-model="email.body" :rows="12" autoresize :maxrows="24" class="w-full" />
                </UFormField>
                <UAlert
                    v-if="draft.notes.length"
                    color="info"
                    icon="i-lucide-list-checks"
                    title="Before sending"
                    :ui="{ description: 'mt-1' }"
                >
                    <template #description>
                        <ul class="list-disc space-y-1 pl-4">
                            <li v-for="note in draft.notes" :key="note">{{ note }}</li>
                        </ul>
                    </template>
                </UAlert>
                <div v-if="draft.documents.length" class="flex flex-wrap items-center gap-2 text-sm">
                    <span class="text-muted">Based on:</span>
                    <UButton
                        v-for="document in draft.documents"
                        :key="document.id"
                        :label="document.name"
                        :to="document.web_view_link ?? undefined"
                        target="_blank"
                        icon="i-lucide-file-text"
                        size="xs"
                        color="neutral"
                    />
                </div>
                <p v-else-if="!draft.documents_considered" class="text-xs text-dimmed">
                    No Drive documents are connected yet. Add Earth Bank's folder in Settings → Knowledge so drafts can
                    use your business documents.
                </p>
                <UAlert
                    v-if="!canSaveToGmail"
                    color="warning"
                    icon="i-lucide-mail-warning"
                    title="Reconnect Gmail to save drafts"
                    description="Your Gmail connection predates drafting. Reconnect it in Settings → Email, or copy the text for now."
                />
            </div>

            <div v-else-if="step === 'saved' && savedDraft" class="space-y-4 text-center">
                <UIcon name="i-lucide-mail-check" class="size-10 text-success" />
                <p class="font-medium text-highlighted">Saved to your Gmail drafts</p>
                <p class="text-sm text-muted">It hasn't been sent. Open it in Gmail to check it and send.</p>
                <UButton
                    :to="savedDraft.open_url"
                    target="_blank"
                    label="Open in Gmail"
                    icon="i-lucide-external-link"
                    variant="solid"
                />
            </div>

            <UAlert v-if="errorMessage" class="mt-4" color="error" icon="i-lucide-circle-alert" :title="errorMessage" />
        </template>

        <template #footer>
            <div class="flex w-full flex-wrap justify-end gap-2">
                <template v-if="step === 'brief'">
                    <UButton label="Cancel" color="neutral" variant="ghost" @click="isOpen = false" />
                    <UButton
                        label="Draft with AI"
                        icon="i-lucide-sparkles"
                        variant="solid"
                        :loading="isDrafting"
                        :disabled="!isGmailConnected || !mailbox?.is_ai_configured"
                        @click="requestDraft"
                    />
                </template>
                <template v-else-if="step === 'review'">
                    <UButton
                        label="Change the brief"
                        icon="i-lucide-arrow-left"
                        color="neutral"
                        variant="ghost"
                        class="mr-auto"
                        @click="step = 'brief'"
                    />
                    <UButton label="Copy text" icon="i-lucide-copy" color="neutral" @click="copyBody" />
                    <UButton
                        label="Save to Gmail drafts"
                        icon="i-lucide-mail-plus"
                        variant="solid"
                        :loading="isSaving"
                        :disabled="!canSaveToGmail"
                        @click="saveToGmail"
                    />
                </template>
                <UButton v-else label="Done" color="neutral" @click="isOpen = false" />
            </div>
        </template>
    </UModal>
</template>
