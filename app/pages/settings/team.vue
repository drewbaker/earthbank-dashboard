<script setup lang="ts">
import { formatDateTime } from '~/utils/format.ts'
import type { TableColumn } from '@nuxt/ui'
import { h, ref, resolveComponent } from 'vue'
import { useAsyncData, useSeoMeta, useToast } from '#imports'
import type { User, UserList } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { useAuth } from '~/composables/useAuth.ts'

useSeoMeta({ title: 'Team · Earth Bank Dashboard' })

const api = useApi()
const toast = useToast()
const { currentUser } = useAuth()
const updatingUserId = ref<string | null>(null)

const { data: team, refresh } = await useAsyncData('settings.team', () => api<UserList>({ path: '/users' }))

const UAvatar = resolveComponent('UAvatar')
const UBadge = resolveComponent('UBadge')

const columns: TableColumn<User>[] = [
    {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) =>
            h('div', { class: 'flex items-center gap-3' }, [
                h(UAvatar, { src: row.original.avatar_url ?? undefined, alt: row.original.name, size: 'sm' }),
                h('div', [
                    h('p', { class: 'font-medium text-highlighted' }, row.original.name),
                    h('p', { class: 'text-muted' }, row.original.email),
                ]),
            ]),
    },
    {
        accessorKey: 'last_sign_in_at',
        header: 'Last sign-in',
        cell: ({ row }) => formatSignIn({ signedInAt: row.original.last_sign_in_at }),
    },
    {
        accessorKey: 'deactivated_at',
        header: 'Status',
        cell: ({ row }) =>
            row.original.deactivated_at
                ? h(UBadge, { color: 'neutral', label: 'Deactivated' })
                : h(UBadge, { color: 'success', label: 'Active' }),
    },
    { id: 'actions', header: '' },
]

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
        <div>
            <h2 class="text-lg font-semibold text-highlighted">Team</h2>
            <p class="text-sm text-muted">
                Anyone with an @theearthbank.org Google account can sign in. Their account is created the first time
                they do. To remove someone, remove them in Google Workspace and deactivate them here.
            </p>
        </div>

        <UTable :data="team?.data ?? []" :columns="columns">
            <template #actions-cell="{ row }">
                <div class="flex justify-end">
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
    </div>
</template>
