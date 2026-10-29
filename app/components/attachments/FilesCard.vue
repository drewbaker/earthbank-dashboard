<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAsyncData, useToast } from '#imports'
import type { Attachment, AttachmentList } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { uploadOwnerFiles } from '~/composables/useAttachmentUpload.ts'
import { formatFileSize, formatRelativeTime } from '~/utils/format.ts'

const props = defineProps<{
    /** The funder's or fund's API path, e.g. `/funds/fmg_…`. */
    ownerPath: string
    /** `funder` files update the pipeline; `fund` files fill the research. */
    ownerKind: 'funder' | 'fund'
    /** A funder's asks, to say which one a file is about. */
    opportunities?: { id: string; name: string }[]
    /** A file to highlight (facts from a fund file link back to it). */
    highlightedFileId?: string | null
    isReadOnly?: boolean
}>()
const emit = defineEmits<{ read: [] }>()

const api = useApi()
const toast = useToast()

const { data: fileList, refresh } = await useAsyncData(`${props.ownerPath}.attachments`, () =>
    api<AttachmentList>({ path: `${props.ownerPath}/attachments` }),
)
const files = computed(() => fileList.value?.data ?? [])

const NO_OPPORTUNITY = 'none'
const opportunityId = ref(NO_OPPORTUNITY)
const opportunityItems = computed(() => [
    { label: 'Not about one ask', value: NO_OPPORTUNITY },
    ...(props.opportunities ?? []).map(opportunity => ({ label: opportunity.name, value: opportunity.id })),
])
const fileInput = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)
const isDragging = ref(false)
const busyFileId = ref<string | null>(null)

const READ_STATUS_DETAILS = {
    queued: { label: 'Waiting to be read', color: 'neutral', icon: 'i-lucide-clock' },
    reading: { label: 'Reading', color: 'info', icon: 'i-lucide-loader-circle' },
    done: { label: 'Read', color: 'success', icon: 'i-lucide-check' },
    skipped: { label: 'Not read', color: 'neutral', icon: 'i-lucide-circle-slash' },
    failed: { label: 'Failed', color: 'error', icon: 'i-lucide-triangle-alert' },
} as const

const isReading = computed(() =>
    files.value.some(file => file.read_status === 'queued' || file.read_status === 'reading'),
)

// While a file is being read, check every few seconds; tell the page when reading finishes so it can
// show what the file added.
let pollTimer: ReturnType<typeof setInterval> | null = null
watch(
    isReading,
    (reading, wasReading) => {
        if (reading && !pollTimer && import.meta.client) {
            pollTimer = setInterval(() => refresh(), 3000)
        }
        if (!reading && pollTimer) {
            clearInterval(pollTimer)
            pollTimer = null
        }
        if (!reading && wasReading) {
            emit('read')
        }
    },
    { immediate: true },
)
onBeforeUnmount(() => {
    if (pollTimer) {
        clearInterval(pollTimer)
    }
})

/**
 * Upload the chosen or dropped files, then list them.
 *
 * @param input.chosen - The files.
 * @returns Resolves once uploaded (or failures are shown).
 */
async function uploadFiles({ chosen }: { chosen: File[] }) {
    if (!chosen.length) {
        return
    }
    isUploading.value = true
    try {
        const failures = await uploadOwnerFiles({
            uploadPath: `/v1${props.ownerPath}/attachments`,
            files: chosen,
            fields: opportunityId.value !== NO_OPPORTUNITY ? { opportunity_id: opportunityId.value } : {},
        })
        for (const failure of failures) {
            toast.add({ title: 'File not uploaded', description: failure, color: 'error' })
        }
        await refresh()
    } finally {
        isUploading.value = false
        if (fileInput.value) {
            fileInput.value.value = ''
        }
    }
}

/**
 * The file input's change handler.
 *
 * @param event - The input's change event.
 * @returns Resolves once uploaded.
 */
function onFilesChosen(event: Event) {
    return uploadFiles({ chosen: [...((event.target as HTMLInputElement).files ?? [])] })
}

/**
 * The drop zone's drop handler.
 *
 * @param event - The drop event.
 * @returns Resolves once uploaded.
 */
function onFilesDropped(event: DragEvent) {
    isDragging.value = false
    if (props.isReadOnly) {
        return
    }
    return uploadFiles({ chosen: [...(event.dataTransfer?.files ?? [])] })
}

/**
 * Have the AI read a file again.
 *
 * @param input.file - The file.
 * @returns Resolves once queued.
 */
async function readAgain({ file }: { file: Attachment }) {
    busyFileId.value = file.id
    try {
        await api({ path: `/attachments/${file.id}/read`, method: 'POST' })
        await refresh()
    } catch (error) {
        toast.add({ title: 'Not queued', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        busyFileId.value = null
    }
}

/**
 * Remove a file (what the AI already took from it stays, with its source).
 *
 * @param input.file - The file.
 * @returns Resolves once removed.
 */
async function removeFile({ file }: { file: Attachment }) {
    busyFileId.value = file.id
    try {
        await api({ path: `/attachments/${file.id}`, method: 'DELETE' })
        await refresh()
    } catch (error) {
        toast.add({ title: 'Not removed', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        busyFileId.value = null
    }
}

/**
 * Who added a file and how: "Uploaded by Drew" or "Emailed by Leslie".
 *
 * @param input.file - The file.
 * @returns The line.
 */
function addedBy({ file }: { file: Attachment }) {
    const verb = file.origin === 'email' ? 'Emailed' : 'Uploaded'
    return `${verb}${file.uploaded_by ? ` by ${file.uploaded_by.name.split(' ')[0]}` : ''} ${formatRelativeTime({ value: file.created_at })}`
}

/**
 * What reading a funder file changed, for the line under its summary.
 *
 * @param input.file - The file.
 * @returns e.g. "2 changes applied, 1 waiting on Activity", or null.
 */
function funderChanges({ file }: { file: Attachment }) {
    const counts = file.read_counts
    if (props.ownerKind !== 'funder' || !counts) {
        return null
    }
    const parts = [
        counts.applied ? `${counts.applied} ${counts.applied === 1 ? 'change' : 'changes'} applied` : null,
        counts.pending ? `${counts.pending} waiting for review on Activity` : null,
        counts.contacts ? `${counts.contacts} ${counts.contacts === 1 ? 'contact' : 'contacts'} added` : null,
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : 'Nothing in the pipeline changed.'
}
</script>

<template>
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 class="font-medium text-highlighted">Files</h2>
                    <p class="text-xs text-muted">
                        <template v-if="ownerKind === 'fund'">
                            PDFs and documents are read by the AI into the research and due diligence, each fact quoted
                            from the file.
                        </template>
                        <template v-else>
                            PDFs and documents are read by the AI, which updates the asks the way an email does.
                        </template>
                        Files emailed to the dashboard address land here too.
                    </p>
                </div>
                <div v-if="!isReadOnly" class="flex flex-wrap items-center gap-2">
                    <USelect
                        v-if="ownerKind === 'funder' && opportunities?.length"
                        v-model="opportunityId"
                        :items="opportunityItems"
                        size="sm"
                        class="w-44"
                        aria-label="Which ask the file is about"
                    />
                    <UButton
                        size="sm"
                        icon="i-lucide-upload"
                        label="Upload"
                        :loading="isUploading"
                        @click="fileInput?.click()"
                    />
                    <input
                        ref="fileInput"
                        type="file"
                        multiple
                        accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,application/pdf"
                        class="hidden"
                        @change="onFilesChosen"
                    />
                </div>
            </div>
        </template>
        <div
            class="files-card__drop-zone"
            :class="{ 'is-dragging': isDragging }"
            @dragover.prevent="isDragging = !isReadOnly"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="onFilesDropped"
        >
            <ul v-if="files.length" class="divide-y divide-default">
                <li
                    v-for="file in files"
                    :id="`file-${file.id}`"
                    :key="file.id"
                    class="space-y-1 px-4 py-3"
                    :class="{ 'bg-elevated/50': file.id === highlightedFileId }"
                >
                    <div class="flex items-start gap-3">
                        <UIcon name="i-lucide-file-text" class="mt-0.5 size-4 shrink-0 text-muted" />
                        <div class="min-w-0 flex-1">
                            <a
                                :href="file.download_url"
                                class="block truncate text-sm font-medium text-primary hover:underline"
                                >{{ file.filename }}</a
                            >
                            <p class="text-xs text-muted">
                                {{ formatFileSize({ bytes: file.size_bytes }) }} · {{ addedBy({ file }) }}
                                <template v-if="file.opportunity"> · {{ file.opportunity.name }}</template>
                            </p>
                        </div>
                        <UBadge
                            v-if="file.read_status"
                            :label="READ_STATUS_DETAILS[file.read_status].label"
                            :color="READ_STATUS_DETAILS[file.read_status].color"
                            :icon="READ_STATUS_DETAILS[file.read_status].icon"
                            :ui="{ leadingIcon: file.read_status === 'reading' ? 'animate-spin' : '' }"
                            variant="soft"
                            size="sm"
                            class="shrink-0"
                        />
                        <UDropdownMenu
                            v-if="!isReadOnly"
                            :items="[
                                {
                                    label: 'Read again',
                                    icon: 'i-lucide-sparkles',
                                    disabled: file.read_status === 'queued' || file.read_status === 'reading',
                                    onSelect: () => readAgain({ file }),
                                },
                                {
                                    label: 'Remove',
                                    icon: 'i-lucide-trash-2',
                                    color: 'error',
                                    onSelect: () => removeFile({ file }),
                                },
                            ]"
                        >
                            <UButton
                                icon="i-lucide-ellipsis"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                :loading="busyFileId === file.id"
                                aria-label="File actions"
                            />
                        </UDropdownMenu>
                    </div>
                    <div class="pl-7 text-sm">
                        <p v-if="file.read_summary" class="text-toned">{{ file.read_summary }}</p>
                        <p v-if="file.read_status === 'done' && funderChanges({ file })" class="text-xs text-muted">
                            {{ funderChanges({ file }) }}
                        </p>
                        <p v-if="file.read_status === 'failed' && file.read_error" class="text-xs text-error">
                            {{ file.read_error }}
                        </p>
                    </div>
                </li>
            </ul>
            <p v-else class="px-4 py-6 text-center text-sm text-muted">
                {{
                    isReadOnly
                        ? 'No files.'
                        : 'No files yet. Upload a PDF or drop it here, or email it to the dashboard address.'
                }}
            </p>
        </div>
    </UCard>
</template>

<style scoped>
.files-card__drop-zone.is-dragging {
    outline: 2px dashed var(--ui-primary);
    outline-offset: -4px;
}
</style>
