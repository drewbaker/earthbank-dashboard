<script setup lang="ts">
import { formatDateTime } from '~/utils/format.ts'
import type { TableColumn } from '@nuxt/ui'
import { h, ref, resolveComponent } from 'vue'
import { useAsyncData, useSeoMeta, useToast } from '#imports'
import type { User, UserList } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { useAuth } from '~/composables/useAuth.ts'
import { sortableColumns } from '~/utils/table-sorting.ts'

useSeoMeta({ title: 'Team · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()
const { currentUser } = useAuth()
const updatingUserId = ref<string | null>(null)
const isInviteOpen = ref(false)

const { data: team, refresh } = await useAsyncData('settings.team', () => api<UserList>({ path: '/users' }))

const UAvatar = resolveComponent('UAvatar')
const UBadge = resolveComponent('UBadge')

const columns: TableColumn<User>[] = sortableColumns({
    columns: [
        {
            id: 'name',
            accessorFn: user => user.name.toLowerCase(),
            header: 'Name',
            cell: ({ row }) =>
                h('div', { class: 'flex items-center gap-3' }, [
                    h(UAvatar, { src: row.original.avatar_url ?? undefined, alt: row.original.name, size: 'sm' }),
                    h('div', [
                        h('p', { class: 'flex items-center gap-2 font-medium text-highlighted' }, [
                            row.original.name,
                            row.original.sign_in_method === 'email_link'
                                ? h(UBadge, { color: 'neutral', label: 'Guest', size: 'sm' })
                                : null,
                        ]),
                        h('p', { class: 'text-muted' }, row.original.email),
                    ]),
                ]),
        },
        {
            id: 'last_sign_in_at',
            accessorFn: user => user.last_sign_in_at ?? undefined,
            header: 'Last sign-in',
            cell: ({ row }) => formatSignIn({ signedInAt: row.original.last_sign_in_at }),
        },
        {
            id: 'status',
            accessorFn: user => (user.deactivated_at ? 'deactivated' : 'active'),
            header: 'Status',
            cell: ({ row }) => {
                if (row.original.deactivated_at) return h(UBadge, { color: 'neutral', label: 'Deactivated' })
                if (!row.original.last_sign_in_at) return h(UBadge, { color: 'warning', label: 'Invited' })
                return h(UBadge, { color: 'success', label: 'Active' })
            },
        },
        { id: 'actions', header: '' },
    ],
})

/**
 * Format a last sign-in timestamp for the table.
 *
 * @param input.signedInAt - ISO timestamp, or null when the user never signed in.
 * @returns A short local date and time.
 */
function formatSignIn({ signedInAt }: { signedInAt: string | null }) {
    return signedInAt ? formatDateTime({ value: signedInAt }) : 'Never'
}

/**
 * Email a guest a fresh invitation link.
 *
 * @param input.user - The guest.
 * @returns Resolves once sent, or once the error is shown.
 */
async function resendInvitation({ user }: { user: User }) {
    updatingUserId.value = user.id
    try {
        await api({ path: `/users/${user.id}/invitation`, method: 'POST' })
        toast.add({ title: `New sign-in link sent to ${user.email}`, color: 'success' })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        updatingUserId.value = null
    }
}

/**
 * Deactivate or reactivate a team member, then reload the list.
 *
 * @param input.user - The team member.
 * @returns Resolves once the list is refreshed.
 */
async function toggleUserAccess({ user }: { user: User }) {
    const action = user.deactivated_at ? 'reactivate' : 'deactivate'
    updatingUserId.value = user.id
    try {
        await api({ path: `/users/${user.id}/${action}`, method: 'POST' })
        toast.add({ title: `${user.name} ${action}d`, color: 'success' })
        await refresh()
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        updatingUserId.value = null
    }
}
</script>

<template>
    <div class="space-y-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="max-w-2xl">
                <h2 class="text-lg font-semibold text-highlighted">Team</h2>
                <p class="text-sm text-muted">
                    Anyone with an @theearthbank.org Google account can sign in. Their account is created the first time
                    they do. To remove someone, remove them in Google Workspace and deactivate them here.
                </p>
                <p class="mt-2 text-sm text-muted">
                    People outside Earth Bank can be invited as guests. They sign in with a link emailed to them and
                    have the same access as everyone else, but can't connect Gmail or Drive.
                </p>
            </div>
            <UButton icon="i-lucide-user-plus" label="Invite a guest" variant="solid" @click="isInviteOpen = true" />
        </div>

        <UTable :data="team?.data ?? []" :columns="columns">
            <template #actions-cell="{ row }">
                <div class="flex justify-end gap-2">
                    <UButton
                        v-if="row.original.sign_in_method === 'email_link' && !row.original.deactivated_at"
                        color="neutral"
                        icon="i-lucide-send"
                        label="Resend link"
                        :loading="updatingUserId === row.original.id"
                        size="sm"
                        @click="resendInvitation({ user: row.original })"
                    />
                    <UButton
                        v-if="row.original.id !== currentUser?.id"
                        :color="row.original.deactivated_at ? 'neutral' : 'error'"
                        :label="row.original.deactivated_at ? 'Reactivate' : 'Deactivate'"
                        :loading="updatingUserId === row.original.id"
                        size="sm"
                        @click="toggleUserAccess({ user: row.original })"
                    />
                </div>
            </template>
        </UTable>

        <TeamInviteGuestModal v-model:open="isInviteOpen" @invited="() => refresh()" />
    </div>
</template>
