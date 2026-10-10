<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive, ref } from 'vue'
import type { z } from 'zod'
import { useAsyncData, useSeoMeta, useToast } from '#imports'
import type { ShareLink, ShareLinkList } from '#shared/schemas/index.ts'
import { CreateShareLinkRequest } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { formatRelativeTime } from '~/utils/format.ts'

useSeoMeta({ title: 'Sharing settings · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()

const { data: links, refresh } = await useAsyncData('settings.sharing.links', () =>
    api<ShareLinkList>({ path: '/share-links' }),
)

const draft = reactive({ label: '', password: '', show_next_steps: true })
const isCreating = ref(false)
const busyLinkId = ref<string | null>(null)

/**
 * Create a link with the validated form values.
 *
 * `UForm`'s `@submit` callback, so it takes the event shape Nuxt UI gives it.
 *
 * @param event - Submit event carrying the validated form data.
 * @returns Resolves once created and the list is fresh.
 */
async function createLink(event: FormSubmitEvent<z.output<typeof CreateShareLinkRequest>>) {
    isCreating.value = true
    try {
        const link = await api<ShareLink>({ path: '/share-links', method: 'POST', body: event.data })
        await navigator.clipboard.writeText(link.url).catch(() => undefined)
        toast.add({
            title: 'Link created and copied',
            description: 'Send the password separately from the link.',
            color: 'success',
        })
        Object.assign(draft, { label: '', password: '', show_next_steps: true })
        await refresh()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isCreating.value = false
    }
}

/**
 * Copy text to the clipboard.
 *
 * @param input.text - What to copy.
 * @param input.title - The confirmation shown.
 * @returns Resolves once copied.
 */
async function copyText({ text, title }: { text: string; title: string }) {
    await navigator.clipboard.writeText(text)
    toast.add({ title, color: 'success' })
}

/**
 * Turn a link off for everyone who has it.
 *
 * @param input.link - The link.
 * @returns Resolves once turned off.
 */
async function revokeLink({ link }: { link: ShareLink }) {
    if (!window.confirm(`Turn off "${link.label}"? Anyone with it loses access straight away.`)) {
        return
    }
    busyLinkId.value = link.id
    try {
        await api({ path: `/share-links/${link.id}`, method: 'DELETE' })
        toast.add({ title: 'Link turned off', color: 'success' })
        await refresh()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        busyLinkId.value = null
    }
}
</script>

<template>
    <div class="space-y-8">
        <section class="space-y-4">
            <div>
                <h2 class="text-lg font-semibold text-highlighted">Share the pipeline with funders</h2>
                <p class="text-sm text-muted">
                    A secret link plus a password opens a read-only page with every design grant and lending capital
                    ask: organization, contact names, geographic focus, amount, status and, if you choose, a short next
                    step. Emails, notes, owners and AI reasoning are never shown. Declined asks are left out.
                </p>
            </div>
            <UCard>
                <UForm
                    :schema="CreateShareLinkRequest"
                    :state="draft"
                    class="grid gap-4 sm:grid-cols-2"
                    @submit="createLink"
                >
                    <UFormField label="Name (for you)" name="label">
                        <UInput v-model="draft.label" placeholder="Funders, October 2026" class="w-full" />
                    </UFormField>
                    <UFormField label="Password" name="password" help="At least 8 characters. Send it separately.">
                        <UInput v-model="draft.password" type="password" autocomplete="new-password" class="w-full" />
                    </UFormField>
                    <USwitch
                        v-model="draft.show_next_steps"
                        label="Show a short next step for each ask"
                        class="sm:col-span-2"
                    />
                    <div class="sm:col-span-2">
                        <UButton type="submit" icon="i-lucide-link" label="Create link" :loading="isCreating" />
                    </div>
                </UForm>
            </UCard>
        </section>

        <section class="space-y-4">
            <h2 class="text-lg font-semibold text-highlighted">Active links</h2>
            <UCard v-if="links?.data.length" :ui="{ body: 'p-0 sm:p-0' }">
                <ul class="divide-y divide-default">
                    <li v-for="link in links.data" :key="link.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div class="min-w-0 flex-1">
                            <p class="font-medium text-highlighted">{{ link.label }}</p>
                            <p class="truncate text-xs text-muted">{{ link.url }}</p>
                            <p class="text-xs text-muted">
                                Password:
                                <code v-if="link.password" class="rounded bg-elevated px-1 text-highlighted">{{
                                    link.password
                                }}</code>
                                <template v-else>not saved (made before passwords were kept; make a new link)</template>
                            </p>
                            <p class="text-xs text-muted">
                                Made by {{ link.created_by?.name ?? 'a former team member' }}
                                {{ formatRelativeTime({ value: link.created_at }) }} ·
                                {{
                                    link.last_viewed_at
                                        ? `last opened ${formatRelativeTime({ value: link.last_viewed_at })}`
                                        : 'not opened yet'
                                }}
                                · {{ link.show_next_steps ? 'shows next steps' : 'hides next steps' }}
                            </p>
                        </div>
                        <UButton
                            size="sm"
                            color="neutral"
                            icon="i-lucide-copy"
                            label="Copy link"
                            @click="copyText({ text: link.url, title: 'Link copied' })"
                        />
                        <UButton
                            v-if="link.password"
                            size="sm"
                            color="neutral"
                            icon="i-lucide-key-round"
                            label="Copy password"
                            @click="copyText({ text: link.password, title: 'Password copied' })"
                        />
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-external-link"
                            label="Open"
                            :to="link.url"
                            target="_blank"
                        />
                        <UButton
                            size="sm"
                            color="error"
                            variant="ghost"
                            icon="i-lucide-link-2-off"
                            label="Turn off"
                            :loading="busyLinkId === link.id"
                            @click="revokeLink({ link })"
                        />
                    </li>
                </ul>
            </UCard>
            <p v-else class="text-sm text-muted">No links yet.</p>
        </section>
    </div>
</template>
