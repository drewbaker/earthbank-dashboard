<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '#imports'
import type { FundDetail, IdentityCandidate } from '#shared/schemas/index.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'

// The research couldn't tell which website or LinkedIn page is this fund's own (common names), so a
// person picks one. Choosing it saves it on the fund, which retires anything from a wrong address and
// refreshes the research.

const props = defineProps<{ fundId: string; candidates: IdentityCandidate[] }>()
const emit = defineEmits<{ updated: [fund: FundDetail] }>()

const api = useApi()
const toast = useToast()
const busyUrl = ref<string | null>(null)

const groups = computed(() =>
    (['website', 'linkedin'] as const)
        .map(kind => ({
            kind,
            title: kind === 'website' ? 'Which is their website?' : 'Which is their LinkedIn page?',
            candidates: props.candidates.filter(candidate => candidate.kind === kind),
        }))
        .filter(group => group.candidates.length > 0),
)

/**
 * Save a candidate as the fund's website or LinkedIn page.
 *
 * @param candidate - The chosen candidate.
 * @returns Resolves once saved.
 */
async function confirmCandidate(candidate: IdentityCandidate) {
    busyUrl.value = candidate.url
    try {
        const fund = await api<FundDetail>({
            path: `/funds/${props.fundId}`,
            method: 'PATCH',
            body: candidate.kind === 'website' ? { website_url: candidate.url } : { linkedin_url: candidate.url },
        })
        emit('updated', fund)
        toast.add({
            title: 'Saved. Refreshing the research',
            description: 'New findings appear as they are verified.',
            color: 'info',
        })
    } catch (error) {
        toast.add({ title: 'Not saved', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        busyUrl.value = null
    }
}

/**
 * "None of these": drop the candidates (the website can still be entered under Team).
 *
 * @returns Resolves once saved.
 */
async function dismissCandidates() {
    busyUrl.value = 'dismiss'
    try {
        const fund = await api<FundDetail>({
            path: `/funds/${props.fundId}`,
            method: 'PATCH',
            body: { dismiss_identity_candidates: true },
        })
        emit('updated', fund)
    } catch (error) {
        toast.add({ title: 'Not saved', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        busyUrl.value = null
    }
}

/**
 * The host of a URL, for display.
 *
 * @param url - The URL.
 * @returns Its host and path, without the protocol.
 */
function displayUrl(url: string) {
    return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
}
</script>

<template>
    <UCard class="identity-candidates" :ui="{ root: 'ring-warning/40' }">
        <template #header>
            <div class="flex items-start justify-between gap-3">
                <div>
                    <p class="font-semibold">Confirm this fund's address</p>
                    <p class="text-muted text-sm">
                        Several organizations share this name, so the research wasn't sure. Pick the right one and it
                        will research from there.
                    </p>
                </div>
                <UButton
                    label="None of these"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :loading="busyUrl === 'dismiss'"
                    @click="dismissCandidates"
                />
            </div>
        </template>
        <div class="space-y-5">
            <div v-for="group in groups" :key="group.kind" class="space-y-2">
                <p class="text-sm font-medium">{{ group.title }}</p>
                <ul class="divide-default divide-y">
                    <li
                        v-for="candidate in group.candidates"
                        :key="candidate.url"
                        class="flex items-start justify-between gap-3 py-2"
                    >
                        <div class="min-w-0 space-y-0.5">
                            <ULink :to="candidate.url" target="_blank" class="text-primary text-sm font-medium">
                                {{ displayUrl(candidate.url) }}
                            </ULink>
                            <p v-if="candidate.title" class="text-sm">{{ candidate.title }}</p>
                            <p v-if="candidate.snippet" class="text-muted line-clamp-2 text-xs">
                                {{ candidate.snippet }}
                            </p>
                            <div v-if="candidate.signals.length" class="flex flex-wrap gap-1 pt-1">
                                <UBadge
                                    v-for="signal in candidate.signals"
                                    :key="signal"
                                    :label="signal"
                                    color="success"
                                    size="sm"
                                />
                            </div>
                        </div>
                        <UButton
                            label="This one"
                            size="sm"
                            :loading="busyUrl === candidate.url"
                            :disabled="busyUrl !== null && busyUrl !== candidate.url"
                            @click="confirmCandidate(candidate)"
                        />
                    </li>
                </ul>
            </div>
        </div>
    </UCard>
</template>
