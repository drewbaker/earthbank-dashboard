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
const isRegenerating = ref(false)

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
 * Replace the forwarding address.
 *
 * @returns Resolves once replaced.
 */
async function regenerateAddress() {
    isRegenerating.value = true
    try {
        await api({ path: '/mailbox/forwarding-address', method: 'POST' })
        toast.add({ title: 'New forwarding address', description: 'The old one no longer works.', color: 'success' })
        await refresh()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isRegenerating.value = false
    }
}

/**
 * Copy the forwarding address to the clipboard.
 *
 * @returns Resolves once copied.
 */
async function copyAddress() {
    if (mailbox.value) {
        await navigator.clipboard.writeText(mailbox.value.forwarding_address)
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
                <h2 class="text-lg font-semibold text-highlighted">Forward an email</h2>
                <p class="text-sm text-muted">
                    Got a funding update somewhere else, like a personal address? Forward it here. If the sender is new,
                    the AI drafts a funder for you to confirm on the Activity page. Keep this address private.
                </p>
            </div>
            <UCard>
                <UAlert
                    v-if="mailbox && !mailbox.is_inbound_configured"
                    color="neutral"
                    variant="subtle"
                    class="mb-4"
                    description="Inbound email isn't set up on the server yet (RESEND_WEBHOOK_SECRET and the inbound domain), so forwarded mail won't arrive."
                />
                <div class="flex flex-wrap items-center gap-2">
                    <code class="flex-1 truncate rounded-md bg-elevated px-3 py-2 text-sm">{{
                        mailbox?.forwarding_address
                    }}</code>
                    <UButton icon="i-lucide-copy" label="Copy" @click="copyAddress" />
                    <UButton
                        icon="i-lucide-rotate-cw"
                        label="New address"
                        color="neutral"
                        variant="ghost"
                        :loading="isRegenerating"
                        @click="regenerateAddress"
                    />
                </div>
            </UCard>
        </section>
    </div>
</template>
