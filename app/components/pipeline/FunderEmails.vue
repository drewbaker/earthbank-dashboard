<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAsyncData } from '#imports'
import type { EmailEvidenceList } from '#shared/schemas/index.ts'
import { useApi } from '~/composables/useApi.ts'
import { formatDate } from '~/utils/format.ts'

const PAGE_SIZE = 20

const props = defineProps<{ funderId: string }>()

const api = useApi()
const isShowingAll = ref(false)
const { data: emails, status } = await useAsyncData(
    `funder.${props.funderId}.emails`,
    () =>
        api<EmailEvidenceList>({
            path: '/email-evidence',
            query: { funder_id: props.funderId, limit: isShowingAll.value ? 500 : PAGE_SIZE },
        }),
    { watch: [isShowingAll] },
)

const sentCount = computed(() => emails.value?.data.filter(email => email.direction === 'sent').length ?? 0)
</script>

<template>
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
            <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h2 class="font-medium text-highlighted">
                    Emails<span v-if="emails?.total" class="text-muted"> ({{ emails.total }})</span>
                </h2>
                <p v-if="emails?.data.length" class="text-xs text-muted">
                    {{ sentCount }} sent · {{ emails.data.length - sentCount }} received
                    <template v-if="emails.has_more"> in the latest {{ emails.data.length }}</template>
                </p>
            </div>
            <p class="text-xs text-muted">
                Every email with this funder that the dashboard has read, with what it said. The emails themselves
                aren't stored; open one in Gmail to read it.
            </p>
        </template>

        <ul v-if="emails?.data.length" class="divide-y divide-default">
            <li v-for="email in emails.data" :key="email.id" class="flex items-start gap-3 px-4 py-3 text-sm">
                <UTooltip :text="email.direction === 'sent' ? 'Sent by Earth Bank' : 'Received from the funder'">
                    <UIcon
                        :name="email.direction === 'sent' ? 'i-lucide-arrow-up-right' : 'i-lucide-arrow-down-left'"
                        class="mt-0.5 size-4 shrink-0"
                        :class="email.direction === 'sent' ? 'text-primary' : 'text-info'"
                    />
                </UTooltip>
                <div class="min-w-0 flex-1 space-y-0.5">
                    <div class="flex flex-wrap items-center gap-2">
                        <p v-if="email.subject" class="min-w-0 truncate font-medium text-highlighted">
                            {{ email.subject }}
                        </p>
                        <p v-else class="text-muted italic">Subject hidden (sensitive email)</p>
                        <UBadge
                            v-if="email.change_count"
                            :label="`${email.change_count} pipeline update${email.change_count === 1 ? '' : 's'}`"
                            color="success"
                            variant="subtle"
                            size="sm"
                        />
                        <UBadge v-if="!email.is_relevant" label="Not about funding" color="neutral" size="sm" />
                    </div>
                    <p :class="email.is_relevant ? '' : 'text-muted'">{{ email.summary }}</p>
                    <p class="text-xs text-muted">
                        {{ email.direction === 'sent' ? 'To' : 'From' }} {{ email.counterpart ?? 'unknown' }} ·
                        {{ formatDate({ value: email.sent_at }) }}
                        <template v-if="email.source === 'forward'"> · forwarded</template>
                        <template v-if="email.mailbox_user"> · from {{ email.mailbox_user.name }}'s Gmail</template>
                    </p>
                </div>
                <UButton
                    v-if="email.gmail_url"
                    :to="email.gmail_url"
                    target="_blank"
                    icon="i-lucide-external-link"
                    label="Gmail"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :aria-label="`Open ${email.subject ?? 'this email'} in Gmail`"
                />
            </li>
        </ul>
        <p v-else-if="status !== 'pending'" class="px-4 py-6 text-center text-sm text-muted">
            No emails yet. Email with this funder's contacts and domains shows up here once someone on the team connects
            Gmail in Settings → Email, or forwards one to their private address.
        </p>
        <div v-if="emails?.has_more || isShowingAll" class="border-t border-default px-4 py-2">
            <UButton
                :label="isShowingAll ? 'Show the latest only' : `Show all ${emails?.total} emails`"
                size="xs"
                color="neutral"
                variant="ghost"
                :loading="status === 'pending'"
                @click="isShowingAll = !isShowingAll"
            />
        </div>
    </UCard>
</template>
