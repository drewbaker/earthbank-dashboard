<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAsyncData, useRoute, useSeoMeta, useToast } from '#imports'
import type { KnowledgeDocument, KnowledgeDocumentList, KnowledgeSourceList } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatRelativeTime } from '~/utils/format.ts'

useSeoMeta({ title: 'Knowledge settings · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()
const route = useRoute()

const { data: sources, refresh: refreshSources } = await useAsyncData('settings.knowledge.sources', () =>
    api<KnowledgeSourceList>({ path: '/knowledge/sources' }),
)
const { data: documents, refresh: refreshDocuments } = await useAsyncData('settings.knowledge.documents', () =>
    api<KnowledgeDocumentList>({ path: '/knowledge/documents' }),
)

const folderLink = ref('')
const busySourceId = ref<string | null>(null)
const busyDocumentId = ref<string | null>(null)

const STATUS_LABELS: Record<
    KnowledgeDocument['status'],
    { label: string; color: 'success' | 'neutral' | 'warning' | 'error' }
> = {
    indexed: { label: 'Read', color: 'success' },
    unsupported: { label: 'Not readable', color: 'neutral' },
    too_large: { label: 'Too large', color: 'warning' },
    failed: { label: 'Failed', color: 'error' },
}

const connectResult = computed(() => {
    const result = route.query.drive
    return (
        {
            connected: {
                color: 'success' as const,
                text: 'Folder connected. Its documents are being read now; refresh in a minute.',
            },
            wrong_account: { color: 'error' as const, text: 'Connect with the same Google account you sign in with.' },
            not_granted: {
                color: 'warning' as const,
                text: 'Google did not grant access to Drive. Try again and allow access.',
            },
            folder_not_found: {
                color: 'error' as const,
                text: "That folder couldn't be opened with your account. Check the link and that it's shared with you.",
            },
            invalid_folder: { color: 'error' as const, text: 'Paste a Google Drive folder link.' },
        }[typeof result === 'string' ? result : ''] ?? null
    )
})

const readableCount = computed(
    () => documents.value?.data.filter(document => document.status === 'indexed' && !document.is_excluded).length ?? 0,
)

/**
 * Start connecting a folder: Google asks for read-only Drive access, then the folder is added.
 *
 * @returns Nothing; the browser leaves the page.
 */
function connectFolder() {
    window.location.href = `/auth/google/drive?folder=${encodeURIComponent(folderLink.value.trim())}`
}

/**
 * Queue a sync of one folder.
 *
 * @param input.sourceId - The folder.
 * @returns Resolves once queued.
 */
async function syncSource({ sourceId }: { sourceId: string }) {
    busySourceId.value = sourceId
    try {
        const result = await api<{ status: 'queued' | 'already_queued' }>({
            path: `/knowledge/sources/${sourceId}/sync`,
            method: 'POST',
        })
        toast.add(
            result.status === 'already_queued'
                ? {
                      title: 'Already syncing',
                      description: 'A sync of this folder is running. Large folders take a few minutes.',
                      color: 'info',
                  }
                : {
                      title: 'Sync started',
                      description: 'Changed documents are read in a minute or two.',
                      color: 'success',
                  },
        )
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        busySourceId.value = null
    }
}

/**
 * Disconnect a folder and delete its synced documents.
 *
 * @param input.sourceId - The folder.
 * @returns Resolves once removed.
 */
async function removeSource({ sourceId }: { sourceId: string }) {
    busySourceId.value = sourceId
    try {
        await api({ path: `/knowledge/sources/${sourceId}`, method: 'DELETE' })
        toast.add({ title: 'Folder disconnected', color: 'success' })
        await Promise.all([refreshSources(), refreshDocuments()])
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        busySourceId.value = null
    }
}

/**
 * Pin or exclude a document.
 *
 * @param input.document - The document.
 * @param input.changes - The flags to set.
 * @returns Resolves once saved.
 */
async function updateDocument({
    document,
    changes,
}: {
    document: KnowledgeDocument
    changes: { is_pinned?: boolean; is_excluded?: boolean }
}) {
    busyDocumentId.value = document.id
    try {
        await api({ path: `/knowledge/documents/${document.id}`, method: 'PATCH', body: changes })
        await refreshDocuments()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        busyDocumentId.value = null
    }
}
</script>

<template>
    <div class="space-y-8">
        <UAlert v-if="connectResult" :color="connectResult.color" :description="connectResult.text" />

        <section class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Google Drive folders</h2>
                <p class="text-sm text-muted">
                    Documents in these folders (business models, explainers, decks) inform AI-drafted emails to funders,
                    so drafts use Earth Bank's own facts and figures. Only files inside the folders you connect are
                    read. Google Docs, Sheets and Slides, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), PDFs and text
                    files are read; old .doc and .ppt files need converting first. Folders re-sync every night.
                </p>
            </div>

            <UCard v-for="source in sources?.data ?? []" :key="source.id">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="text-sm">
                        <p class="flex items-center gap-2 text-highlighted">
                            <UIcon name="i-lucide-folder" class="size-4 text-muted" />
                            <a :href="source.drive_url" target="_blank" class="hover:underline">{{ source.name }}</a>
                            <UBadge
                                :label="source.status === 'active' ? 'Connected' : 'Needs reconnecting'"
                                :color="source.status === 'active' ? 'success' : 'error'"
                                size="sm"
                            />
                        </p>
                        <p class="text-muted">
                            {{ source.document_count }} files · connected by
                            {{ source.connected_by?.name ?? 'someone' }}
                            ·
                            {{
                                source.last_synced_at
                                    ? `synced ${formatRelativeTime({ value: source.last_synced_at })}`
                                    : 'first sync in progress (large folders take a few minutes)'
                            }}
                        </p>
                        <p v-if="source.last_error" class="text-error">{{ source.last_error }}</p>
                    </div>
                    <div class="flex gap-2">
                        <UButton
                            v-if="source.status === 'error'"
                            :to="`/auth/google/drive?folder=${source.drive_folder_id}`"
                            external
                            label="Reconnect"
                            variant="solid"
                        />
                        <UButton
                            v-else
                            icon="i-lucide-refresh-cw"
                            label="Sync now"
                            :loading="busySourceId === source.id"
                            @click="syncSource({ sourceId: source.id })"
                        />
                        <UButton
                            label="Disconnect"
                            color="error"
                            variant="ghost"
                            :disabled="busySourceId === source.id"
                            @click="removeSource({ sourceId: source.id })"
                        />
                    </div>
                </div>
            </UCard>

            <UCard>
                <form class="flex flex-col gap-3 sm:flex-row sm:items-end" @submit.prevent="connectFolder">
                    <UFormField
                        label="Add a folder"
                        name="folder"
                        help="Paste the folder's link from Google Drive. Google will ask you to allow read-only Drive access."
                        class="flex-1"
                    >
                        <UInput
                            v-model="folderLink"
                            placeholder="https://drive.google.com/drive/folders/…"
                            icon="i-lucide-link"
                            class="w-full"
                        />
                    </UFormField>
                    <UButton
                        type="submit"
                        label="Connect folder"
                        icon="i-lucide-folder-plus"
                        variant="solid"
                        :disabled="!folderLink.trim()"
                    />
                </form>
            </UCard>
        </section>

        <section v-if="documents?.data.length" class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Documents</h2>
                <p class="text-sm text-muted">
                    {{ readableCount }} documents are available to the AI. When they're too long to read all at once,
                    pinned documents (like the three-page explainer) are always read in full and the most relevant
                    passages of the rest are picked for each email. Exclude anything that shouldn't inform emails.
                </p>
            </div>
            <UCard :ui="{ body: 'p-0 sm:p-0' }">
                <ul class="divide-y divide-default">
                    <li
                        v-for="document in documents.data"
                        :key="document.id"
                        class="flex flex-wrap items-center gap-3 px-4 py-2 text-sm"
                        :class="document.is_excluded ? 'opacity-60' : ''"
                    >
                        <UIcon name="i-lucide-file-text" class="size-4 text-muted" />
                        <a
                            :href="document.web_view_link ?? undefined"
                            target="_blank"
                            class="min-w-0 flex-1 truncate text-highlighted hover:underline"
                        >
                            {{ document.name }}
                        </a>
                        <UBadge
                            :label="STATUS_LABELS[document.status].label"
                            :color="STATUS_LABELS[document.status].color"
                            size="sm"
                        />
                        <template v-if="document.status === 'indexed'">
                            <USwitch
                                :model-value="document.is_pinned"
                                label="Pinned"
                                size="sm"
                                :disabled="busyDocumentId === document.id || document.is_excluded"
                                @update:model-value="updateDocument({ document, changes: { is_pinned: $event } })"
                            />
                            <USwitch
                                :model-value="document.is_excluded"
                                label="Excluded"
                                size="sm"
                                :disabled="busyDocumentId === document.id"
                                @update:model-value="updateDocument({ document, changes: { is_excluded: $event } })"
                            />
                        </template>
                    </li>
                </ul>
            </UCard>
        </section>
    </div>
</template>
