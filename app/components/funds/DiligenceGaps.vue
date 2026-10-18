<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '#imports'
import { FUND_DILIGENCE_QUESTION_DETAILS } from '#shared/constants/funds.ts'
import type { FundDetail, FundDiligenceItem } from '#shared/schemas/index.ts'
import { displayUrl } from '#shared/utils/display-url.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatDate } from '~/utils/format.ts'

const props = defineProps<{ fundId: string; items: FundDiligenceItem[] }>()
const emit = defineEmits<{ saved: [fund: FundDetail] }>()

const api = useApi()
const toast = useToast()
const editingQuestion = ref<string | null>(null)
const draftAnswer = ref('')
const savingQuestion = ref<string | null>(null)

const gapCount = computed(() => props.items.filter(item => item.answer === null).length)

/**
 * Open the editor for one question.
 *
 * @param input.item - The question and its current answer.
 * @returns Nothing.
 */
function startEditing({ item }: { item: FundDiligenceItem }) {
    editingQuestion.value = item.question
    draftAnswer.value = item.answer ?? ''
}

/**
 * Save the person's answer, or clear it when the box is empty.
 *
 * @param input.item - The question.
 * @returns Resolves once saved.
 */
async function saveAnswer({ item }: { item: FundDiligenceItem }) {
    savingQuestion.value = item.question
    try {
        const answer = draftAnswer.value.trim()
        const fund = await api<FundDetail>({
            path: `/funds/${props.fundId}/diligence/${item.question}`,
            method: answer ? 'PUT' : 'DELETE',
            body: answer ? { answer } : undefined,
        })
        editingQuestion.value = null
        emit('saved', fund)
    } catch (error) {
        toast.add({ title: 'Answer not saved', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        savingQuestion.value = null
    }
}
</script>

<template>
    <UCard>
        <template #header>
            <div class="flex items-center justify-between gap-2">
                <div>
                    <h2 class="font-semibold text-highlighted">Due diligence</h2>
                    <p class="text-sm text-muted">
                        Entered by people. The AI fills one in only when the fund has published the answer.
                    </p>
                </div>
                <UBadge
                    :color="gapCount > 0 ? 'warning' : 'success'"
                    variant="subtle"
                    :label="gapCount > 0 ? `${gapCount} to track down` : 'All answered'"
                />
            </div>
        </template>
        <ul class="divide-y divide-default">
            <li v-for="item in items" :key="item.question" class="space-y-2 py-3">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="font-medium text-highlighted">
                            <UIcon
                                :name="item.answer ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'"
                                class="mr-1 size-4 align-text-bottom"
                                :class="item.answer ? 'text-success' : 'text-warning'"
                            />
                            {{ FUND_DILIGENCE_QUESTION_DETAILS[item.question].label }}
                        </p>
                        <p class="text-xs text-muted">{{ FUND_DILIGENCE_QUESTION_DETAILS[item.question].hint }}</p>
                    </div>
                    <UButton
                        v-if="editingQuestion !== item.question"
                        :label="item.answer ? 'Edit' : 'Answer'"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-pencil"
                        @click="startEditing({ item })"
                    />
                </div>
                <div v-if="editingQuestion === item.question" class="space-y-2">
                    <UTextarea
                        v-model="draftAnswer"
                        :rows="3"
                        autoresize
                        class="w-full"
                        placeholder="What you found out, and from whom"
                    />
                    <div class="flex justify-end gap-2">
                        <UButton
                            label="Cancel"
                            size="sm"
                            color="neutral"
                            variant="ghost"
                            @click="editingQuestion = null"
                        />
                        <UButton
                            :label="draftAnswer.trim() ? 'Save' : 'Clear answer'"
                            size="sm"
                            variant="solid"
                            :loading="savingQuestion === item.question"
                            @click="saveAnswer({ item })"
                        />
                    </div>
                </div>
                <div v-else-if="item.answer" class="space-y-1 rounded-md bg-elevated/50 p-2">
                    <p class="whitespace-pre-line text-sm">{{ item.answer }}</p>
                    <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <UBadge
                            :label="item.source === 'ai' ? 'AI, from public sources' : 'Team'"
                            :color="item.source === 'ai' ? 'info' : 'primary'"
                            variant="soft"
                            size="sm"
                        />
                        <!-- Answers read from an imported note are credited to that note. -->
                        <a
                            v-if="item.note"
                            :href="item.note.url ?? undefined"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="underline hover:text-highlighted"
                            >{{ item.note.title }}</a
                        >
                        <template v-else>
                            <span v-if="item.answered_by">{{ item.answered_by.name }}</span>
                            <span v-if="item.updated_at">{{ formatDate({ value: item.updated_at }) }}</span>
                        </template>
                        <a
                            v-for="url in item.note ? [] : item.source_urls"
                            :key="url"
                            :href="url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="underline hover:text-highlighted"
                            >{{ displayUrl({ url }).split('/')[0] }}</a
                        >
                    </div>
                </div>
            </li>
        </ul>
    </UCard>
</template>
