<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useAsyncData, useRoute, useSeoMeta, useToast } from '#imports'
import type { MailboxStatus } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatRelativeTime } from '~/utils/format.ts'

useSeoMeta({ title: 'Email settings · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()
const route = useRoute()

const { data: mailbox, refresh } = await useAsyncData('settings.mailbox', () =>
    api<MailboxStatus>({ path: '/mailbox' }),
)
const isSyncing = ref(false)
const isDisconnecting = ref(false)

// While a sync is waiting or running, refresh every 2 seconds so its progress moves.
const isSyncActive = computed(() => ['queued', 'running'].includes(mailbox.value?.connection?.sync.state ?? 'idle'))
const syncPolling = useIntervalFn(() => refresh(), 2000, { immediate: false })
watch(
    isSyncActive,
    isActive => {
        if (isActive) {
            syncPolling.resume()
        } else {
            syncPolling.pause()
        }
    },
    { immediate: true },
)

const connectResult = computed(() => {
    const result = route.query.gmail
    return (
        {
            connected: {
                color: 'success' as const,
                text: 'Gmail connected. The first sync is running and looks back 90 days.',
            },
            wrong_account: { color: 'error' as const, text: 'Connect the same Google account you sign in with.' },
            not_granted: {
                color: 'warning' as const,
                text: 'Google did not grant access to mail. Try again and allow access.',
            },
        }[typeof result === 'string' ? result : ''] ?? null
    )
})

/**
 * Queue a Gmail sync now.
 *
 * @returns Resolves once queued.
 */
async function syncNow() {
    isSyncing.value = true
    try {
        const result = await api<{ status: 'queued' | 'already_queued' }>({ path: '/mailbox/sync', method: 'POST' })
        if (result.status === 'already_queued') {
            toast.add({ title: 'Already syncing', description: 'Progress is shown below.', color: 'info' })
        }
        await refresh()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isSyncing.value = false
    }
}

/**
 * Disconnect Gmail (revokes access at Google).
 *
 * @returns Resolves once disconnected.
 */
async function disconnect() {
    isDisconnecting.value = true
    try {
        await api({ path: '/mailbox', method: 'DELETE' })
        toast.add({ title: 'Gmail disconnected', color: 'success' })
        await refresh()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isDisconnecting.value = false
    }
}

/**
 * Copy an inbound address to the clipboard.
 *
 * @param input.address - The address to copy.
 * @returns Resolves once copied.
 */
async function copyAddress({ address }: { address: string | undefined }) {
    if (address) {
        await navigator.clipboard.writeText(address)
        toast.add({ title: 'Copied', color: 'success' })
    }
}
</script>

<template>
    <div class="space-y-8">
        <UAlert v-if="connectResult" :color="connectResult.color" :description="connectResult.text" />
        <UAlert
            v-if="mailbox && !mailbox.is_ai_configured"
            color="warning"
            icon="i-lucide-sparkles"
            title="AI isn't configured"
            description="Set ANTHROPIC_API_KEY on the server. Until then connected mail isn't read."
        />

        <section class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Gmail</h2>
                <p class="text-sm text-muted">
                    The dashboard reads only email to or from people and domains in the pipeline, every 15 minutes. It
                    keeps a short summary of each, never the email itself, and suggests pipeline updates you can review
                    on the Activity page. It can also save AI-drafted replies to your Gmail drafts; it never sends
                    email.
                </p>
            </div>
            <UCard>
                <div v-if="mailbox?.connection" class="flex flex-wrap items-center justify-between gap-3">
                    <div class="text-sm">
                        <p class="text-highlighted">
                            {{ mailbox.connection.google_email }}
                            <UBadge
                                :label="mailbox.connection.status === 'active' ? 'Connected' : 'Needs reconnecting'"
                                :color="mailbox.connection.status === 'active' ? 'success' : 'error'"
                                size="sm"
                                class="ml-1"
                            />
                        </p>
                        <p v-if="!mailbox.connection.sync.last_result" class="text-muted">
                            Last synced
                            {{
                                mailbox.connection.last_synced_at
                                    ? formatRelativeTime({ value: mailbox.connection.last_synced_at })
                                    : 'not yet'
                            }}
                        </p>
                        <EmailSyncProgress
                            :sync="mailbox.connection.sync"
                            :is-first-sync="!mailbox.connection.last_synced_at"
                            class="mt-2"
                        />
                        <p v-if="mailbox.connection.last_error" class="text-error">
                            {{ mailbox.connection.last_error }}
                        </p>
                        <p v-else-if="!mailbox.connection.can_create_drafts" class="text-warning">
                            Reconnect to let the dashboard save drafted replies to your Gmail.
                        </p>
                    </div>
                    <div class="flex gap-2">
                        <UButton
                            v-if="mailbox.connection.status === 'error' || !mailbox.connection.can_create_drafts"
                            to="/auth/google/gmail"
                            external
                            label="Reconnect"
                            variant="solid"
                        />
                        <UButton
                            v-if="mailbox.connection.status === 'active'"
                            icon="i-lucide-refresh-cw"
                            :label="isSyncActive ? 'Syncing…' : 'Sync now'"
                            :loading="isSyncing || isSyncActive"
                            :disabled="isSyncActive"
                            @click="syncNow"
                        />
                        <UButton
                            label="Disconnect"
                            color="error"
                            variant="ghost"
                            :loading="isDisconnecting"
                            @click="disconnect"
                        />
                    </div>
                </div>
                <div v-else class="flex flex-wrap items-center justify-between gap-3">
                    <p class="text-sm text-muted">
                        Not connected. Google will ask you to allow reading your mail and saving drafts.
                    </p>
                    <UButton
                        to="/auth/google/gmail"
                        external
                        icon="i-lucide-mail"
                        label="Connect Gmail"
                        variant="solid"
                    />
                </div>
            </UCard>
        </section>

        <section class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Email the dashboard</h2>
                <p class="text-sm text-muted">
                    Email this address from your Earth Bank account and the AI does what you ask, as you, then replies
                    with what it changed or the answer to your question.
                </p>
            </div>
            <UCard>
                <UAlert
                    v-if="mailbox && !mailbox.is_inbound_configured"
                    color="neutral"
                    variant="subtle"
                    class="mb-4"
                    description="Inbound email isn't set up on the server yet (RESEND_WEBHOOK_SECRET and the inbound domain), so email to this address won't arrive."
                />
                <div class="flex flex-wrap items-center gap-2">
                    <code class="flex-1 truncate rounded-md bg-elevated px-3 py-2 text-sm">{{
                        mailbox?.dashboard_address
                    }}</code>
                    <UButton
                        icon="i-lucide-copy"
                        label="Copy"
                        @click="copyAddress({ address: mailbox?.dashboard_address })"
                    />
                </div>
                <dl class="mt-4 space-y-3 text-sm">
                    <div>
                        <dt class="font-medium text-highlighted">What gets read</dt>
                        <dd class="text-muted">
                            The body of your email is your request. If the body is empty, the subject line is used
                            instead, so a one-line question in the subject works. When the body has your request, the
                            subject is only background.
                        </dd>
                    </div>
                    <div>
                        <dt class="font-medium text-highlighted">Forwarding an email</dt>
                        <dd class="text-muted">
                            Write your request above the forwarded message ("Add this funder to our tracker"). The
                            forwarded email is read for context, but anything it asks for is never done, only what you
                            wrote. Forward with no note and it just updates the funder it's about, or drafts a new one
                            for review on the Activity page.
                        </dd>
                    </div>
                    <div>
                        <dt class="font-medium text-highlighted">Things you can ask</dt>
                        <dd>
                            <ul class="mt-1 list-disc space-y-1 pl-5 text-muted">
                                <li>"What's the latest on Schmidt?"</li>
                                <li>"Update the UBS grant to approved" (the funding date is set 60 days out)</li>
                                <li>"UBS went to committee, decision expected Dec 15"</li>
                                <li>"Make a task for Steve to send the budget by Friday"</li>
                            </ul>
                        </dd>
                    </div>
                </dl>
                <p class="mt-4 text-xs text-muted">
                    Only email that Google confirms came from an Earth Bank account is acted on, so send it from your
                    Earth Bank Gmail, not a personal address. To pass on mail from a personal inbox, forward it to your
                    Earth Bank account first.
                </p>
            </UCard>
        </section>
    </div>
</template>
