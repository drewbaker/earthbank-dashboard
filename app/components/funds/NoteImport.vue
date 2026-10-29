<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '#imports'
import { FUND_DILIGENCE_QUESTION_DETAILS } from '#shared/constants/funds.ts'
import type { FundDetail, FundNote } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'

const props = defineProps<{ fundId: string; notes: FundNote[]; highlightedNoteId?: string | null }>()
const emit = defineEmits<{ imported: [fund: FundDetail] }>()

const api = useApi()
const toast = useToast()

const NOTE_ORIGIN_LABELS: Record<FundNote['origin'], string> = {
    pasted: 'Pasted',
    google_doc: 'Google Doc',
    attachment: 'File',
}

type ImportMode = 'paste' | 'google_doc'
const mode = ref<ImportMode>('paste')
const modeItems = [
    { label: 'Paste text', value: 'paste', icon: 'i-lucide-clipboard-paste' },
    { label: 'Google Doc link', value: 'google_doc', icon: 'i-lucide-file-text' },
]
const pastedText = ref('')
const docUrl = ref('')
const isImporting = ref(false)
const latestNoteId = ref<string | null>(null)

const canImport = computed(() => (mode.value === 'paste' ? pastedText.value.trim() : docUrl.value.trim()).length > 0)

/**
 * Send the note to be read, then show what it filled in.
 *
 * @returns Resolves once imported, or once the error is shown.
 */
async function importNote() {
    isImporting.value = true
    try {
        const fund = await api<FundDetail>({
            path: `/funds/${props.fundId}/notes`,
            method: 'POST',
            body: mode.value === 'paste' ? { text: pastedText.value } : { doc_url: docUrl.value },
        })
        const note = fund.imported_notes[0]
        latestNoteId.value = note?.id ?? null
        pastedText.value = ''
        docUrl.value = ''
        emit('imported', fund)
        toast.add({ title: 'Note imported', description: note ? noteSummary({ note }) : undefined, color: 'success' })
    } catch (error) {
        toast.add({ title: 'Note not imported', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isImporting.value = false
    }
}

/**
 * One line on what a note filled in.
 *
 * @param input.note - The imported note.
 * @returns e.g. "5 facts, 2 people, 3 diligence answers".
 */
function noteSummary({ note }: { note: FundNote }) {
    const parts = [
        [note.findings_added, 'fact'],
        [note.people_added, 'person'],
        [note.diligence_answered, 'diligence answer'],
    ]
        .filter(([count]) => Number(count) > 0)
        .map(
            ([count, noun]) =>
                `${count} ${noun === 'person' && Number(count) > 1 ? 'people' : `${noun}${Number(count) > 1 ? 's' : ''}`}`,
        )
    return parts.length ? parts.join(', ') : 'Nothing new found in this note'
}
</script>

<template>
    <div class="space-y-6">
        <UCard>
            <template #header>
                <h2 class="font-semibold text-highlighted">Import notes</h2>
                <p class="text-sm text-muted">
                    Paste call notes or link a Google Doc. The AI fills in this profile and due diligence from what the
                    note says, quoting it, and credits each fact as a note from you. Answers someone already typed are
                    kept. For PDFs and other files, use the Files tab.
                </p>
            </template>
            <div class="space-y-4">
                <UTabs v-model="mode" :items="modeItems" :content="false" size="sm" />
                <UTextarea
                    v-if="mode === 'paste'"
                    v-model="pastedText"
                    :rows="10"
                    autoresize
                    :maxrows="30"
                    placeholder="Paste call notes, an email or a memo about this fund…"
                    class="w-full"
                />
                <UFormField
                    v-else
                    label="Google Doc link"
                    hint="Read with your Google account (connect Drive in Settings → Knowledge)"
                >
                    <UInput
                        v-model="docUrl"
                        placeholder="https://docs.google.com/document/d/…"
                        icon="i-lucide-link"
                        class="w-full"
                    />
                </UFormField>
                <div class="flex flex-wrap items-center gap-3">
                    <UButton
                        label="Import"
                        icon="i-lucide-sparkles"
                        variant="solid"
                        :loading="isImporting"
                        :disabled="!canImport"
                        @click="importNote"
                    />
                    <span v-if="isImporting" class="text-sm text-muted">Reading the note; this can take a minute.</span>
                </div>
            </div>
        </UCard>

        <UCard>
            <template #header>
                <h2 class="font-semibold text-highlighted">Imported notes</h2>
            </template>
            <ul v-if="notes.length" class="divide-y divide-default">
                <li
                    v-for="note in notes"
                    :id="`note-${note.id}`"
                    :key="note.id"
                    class="space-y-2 py-3"
                    :class="{
                        'rounded-md bg-elevated/50 px-3': note.id === latestNoteId || note.id === highlightedNoteId,
                    }"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="flex min-w-0 flex-wrap items-center gap-2">
                            <span class="font-medium text-highlighted">{{ note.title }}</span>
                            <UBadge :label="NOTE_ORIGIN_LABELS[note.origin]" color="neutral" variant="soft" size="sm" />
                            <a
                                v-if="note.doc_url"
                                :href="note.doc_url"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-sm underline"
                                >Open doc</a
                            >
                            <NuxtLink
                                v-if="note.attachment_id"
                                :to="{ query: { tab: 'files', file: note.attachment_id } }"
                                class="text-sm underline"
                                >Open file</NuxtLink
                            >
                        </div>
                        <UBadge
                            v-if="note.status !== 'done'"
                            :label="note.status === 'failed' ? 'Failed' : 'Reading'"
                            :color="note.status === 'failed' ? 'error' : 'info'"
                            variant="soft"
                            size="sm"
                        />
                    </div>
                    <p v-if="note.status === 'done'" class="text-sm text-muted">
                        {{ noteSummary({ note })
                        }}{{
                            note.dropped ? ` · ${note.dropped} not kept (couldn't be matched to the note's words)` : ''
                        }}
                    </p>
                    <p v-if="note.error" class="text-sm text-error">{{ note.error }}</p>
                    <div v-if="note.kept_existing.length" class="space-y-1 text-sm">
                        <p class="text-muted">
                            The note also answers these, but someone had already answered them, so their answer was
                            kept. Update them on the Due diligence tab if the note is newer:
                        </p>
                        <ul class="list-disc space-y-1 pl-5">
                            <li v-for="item in note.kept_existing" :key="item.question">
                                <span class="font-medium"
                                    >{{ FUND_DILIGENCE_QUESTION_DETAILS[item.question].label }}:</span
                                >
                                {{ item.answer }}
                            </li>
                        </ul>
                    </div>
                </li>
            </ul>
            <p v-else class="text-sm text-dimmed">No notes imported yet.</p>
        </UCard>
    </div>
</template>
