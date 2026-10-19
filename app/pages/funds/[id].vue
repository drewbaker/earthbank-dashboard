<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useAsyncData, useRoute, useSeoMeta, useToast } from '#imports'
import type { FundFitTag, FundResearchField, FundResearchGroup, FundStage } from '#shared/constants/funds.ts'
import {
    AFFILIATION_RELATIONS,
    FUND_FIT_TAG_LABELS,
    FUND_FIT_TAGS,
    FUND_ORIGIN_LABELS,
    FUND_RESEARCH_FIELD_DETAILS,
    FUND_RESEARCH_FIELDS,
    FUND_RESEARCH_GROUP_LABELS,
    FUND_SOURCE_KIND_LABELS,
    FUND_STAGE_DETAILS,
    FUND_STAGES,
} from '#shared/constants/funds.ts'
import { countryName } from '#shared/funds/finding-display.ts'
import type { FundDetail, FundFinding, FundNetwork, FundSourceLink } from '#shared/schemas/index.ts'
import { displayUrl } from '#shared/utils/display-url.ts'
import { geoFocusOptions } from '#shared/utils/geo-focus.ts'
import { apiErrorMessage, useApi } from '~/composables/useApi.ts'
import { NO_OWNER, ownerIdFromSelection, usePipelineReference } from '~/composables/usePipelineReference.ts'
import { formatDateTime, formatMoney } from '~/utils/format.ts'

const route = useRoute()
const api = useApi()
const toast = useToast()
const { ownerItems } = usePipelineReference()
const fundId = computed(() => String(route.params.id))

const { data: fund, error: loadError } = await useAsyncData(`fund.${fundId.value}`, () =>
    api<FundDetail>({ path: `/funds/${fundId.value}` }),
)

useSeoMeta({ title: () => `${fund.value?.name ?? 'Fund'} · Earth Bank Dashboard` })

const PROFILE_TABS = ['overview', 'team', 'track_record', 'presence', 'diligence', 'import', 'sources'] as const
type ProfileTab = (typeof PROFILE_TABS)[number]
// ?tab=import&note=… opens a tab directly (facts from a pasted note link back to it this way).
const tab = ref<ProfileTab>(
    PROFILE_TABS.includes(route.query.tab as ProfileTab) ? (route.query.tab as ProfileTab) : 'overview',
)
const highlightedNoteId = computed(() => (typeof route.query.note === 'string' ? route.query.note : null))
const tabItems = computed(() => [
    { label: 'Overview', value: 'overview', icon: 'i-lucide-file-text' },
    { label: `Team & network (${fund.value?.people.length ?? 0})`, value: 'team', icon: 'i-lucide-users' },
    { label: 'Deals & LPs', value: 'track_record', icon: 'i-lucide-handshake' },
    { label: 'News & impact', value: 'presence', icon: 'i-lucide-newspaper' },
    { label: `Due diligence (${diligenceGapCount.value} gaps)`, value: 'diligence', icon: 'i-lucide-clipboard-check' },
    { label: 'Import', value: 'import', icon: 'i-lucide-file-input' },
    { label: 'Sources', value: 'sources', icon: 'i-lucide-link' },
])

// The network is only fetched when its tab is opened.
const { data: network, execute: loadNetwork } = await useAsyncData(
    `fund.${fundId.value}.network`,
    () => api<FundNetwork>({ path: `/funds/${fundId.value}/network` }),
    { immediate: false },
)
watch(tab, value => {
    if (value === 'team' && !network.value) {
        loadNetwork()
    }
})

const findingsByField = computed(() => {
    const grouped = new Map<FundResearchField, FundFinding[]>()
    for (const finding of fund.value?.findings ?? []) {
        grouped.set(finding.field, [...(grouped.get(finding.field) ?? []), finding])
    }
    return grouped
})

// The list fields each tab shows: track record, or news and presence.
const TRACK_RECORD_FIELDS: FundResearchField[] = ['fund_raise', 'deal', 'lp', 'public_record']
const PRESENCE_FIELDS: FundResearchField[] = ['news', 'impact_metric', 'success_story', 'conference', 'social_account']
const listFieldsForTab = computed(() => (tab.value === 'track_record' ? TRACK_RECORD_FIELDS : PRESENCE_FIELDS))

const diligenceGapCount = computed(() => (fund.value?.diligence ?? []).filter(item => item.answer === null).length)

/**
 * The research fields in one group, in their fixed order.
 *
 * @param input.group - The group.
 * @returns Field keys.
 */
function fieldsInGroup({ group }: { group: FundResearchGroup }) {
    return FUND_RESEARCH_FIELDS.filter(field => FUND_RESEARCH_FIELD_DETAILS[field].group === group)
}

// Every page any fact on this profile came from, newest first.
const allSources = computed(() => {
    const byUrl = new Map<string, FundSourceLink & { uses: number }>()
    const add = (sources: FundSourceLink[]) => {
        for (const source of sources) {
            const existing = byUrl.get(source.url)
            byUrl.set(source.url, { ...source, quote: null, uses: (existing?.uses ?? 0) + 1 })
        }
    }
    for (const finding of fund.value?.findings ?? []) {
        add(finding.sources)
    }
    for (const person of fund.value?.people ?? []) {
        add(person.sources)
        person.affiliations.forEach(affiliation => add(affiliation.sources))
    }
    return [...byUrl.values()].sort((a, b) => b.retrieved_at.localeCompare(a.retrieved_at))
})

const stageItems = FUND_STAGES.map(stage => ({ label: FUND_STAGE_DETAILS[stage].label, value: stage }))
const fitTagItems = FUND_FIT_TAGS.map(tag => ({ label: FUND_FIT_TAG_LABELS[tag], value: tag }))
const relationLabels: Record<(typeof AFFILIATION_RELATIONS)[number], string> = {
    employment: 'Worked at',
    education: 'Studied at',
    board: 'Board of',
}

const teamForm = reactive({
    stage: 'new_addition' as FundStage,
    fit_tags: [] as FundFitTag[],
    owner_id: NO_OWNER,
    notes: '',
    website_url: '',
    linkedin_url: '',
    focus_areas: [] as string[],
})
// Regions and countries for the focus picker, grouped: Global, regions, then countries by name.
const focusItems = (['Global', 'Regions', 'Countries'] as const).map(group => [
    // Group headings aren't selectable; the value only satisfies the item type.
    { type: 'label' as const, label: group, value: `group:${group}` },
    ...geoFocusOptions()
        .filter(option => option.group === group)
        .map(option => ({ label: option.label, value: option.code })),
])
watch(
    fund,
    value => {
        if (value) {
            teamForm.stage = value.stage
            teamForm.fit_tags = [...value.fit_tags]
            teamForm.owner_id = value.owner?.id ?? NO_OWNER
            teamForm.notes = value.notes ?? ''
            teamForm.website_url = value.website_url ?? ''
            teamForm.linkedin_url = value.linkedin_url ?? ''
            teamForm.focus_areas = [...value.focus_areas]
        }
    },
    { immediate: true },
)
const isSavingTeam = ref(false)
const isResearching = ref(false)
const isArchiving = ref(false)
const isApproving = ref(false)
const busyFindingId = ref<string | null>(null)

/**
 * Save the team's own fields (website, LinkedIn page, stage, fit tags, owner, notes). A corrected
 * website or LinkedIn page also refreshes the research (the server retires what came from the old one).
 *
 * @returns Resolves once saved.
 */
async function saveTeamFields() {
    isSavingTeam.value = true
    const before = { website: fund.value?.website_url ?? '', linkedin: fund.value?.linkedin_url ?? '' }
    try {
        fund.value = await api<FundDetail>({
            path: `/funds/${fundId.value}`,
            method: 'PATCH',
            body: {
                website_url: teamForm.website_url.trim() || null,
                linkedin_url: teamForm.linkedin_url.trim() || null,
                stage: teamForm.stage,
                fit_tags: teamForm.fit_tags,
                owner_id: ownerIdFromSelection({ ownerId: teamForm.owner_id }),
                notes: teamForm.notes.trim() || null,
                // Only sent when changed, so saving other fields doesn't pin research's focus as the team's.
                ...(isFocusChanged() ? { focus_areas: teamForm.focus_areas } : {}),
            },
        })
        const isNewAddress =
            (fund.value?.website_url ?? '') !== before.website || (fund.value?.linkedin_url ?? '') !== before.linkedin
        toast.add(
            isNewAddress
                ? {
                      title: 'Saved. Refreshing the research',
                      description:
                          'Research from the old address was retired; new findings appear as they are verified.',
                      color: 'info',
                  }
                : { title: 'Saved', color: 'success' },
        )
    } catch (error) {
        toast.add({ title: 'Not saved', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isSavingTeam.value = false
    }
}

/**
 * Whether the focus in the form differs from the fund's (order ignored).
 *
 * @returns True when the team changed it.
 */
function isFocusChanged() {
    const saved = [...(fund.value?.focus_areas ?? [])].sort().join(',')
    return [...teamForm.focus_areas].sort().join(',') !== saved
}

/**
 * Drop the team's regional focus and go back to what research found.
 *
 * @returns Resolves once saved.
 */
async function useResearchFocus() {
    isSavingTeam.value = true
    try {
        fund.value = await api<FundDetail>({
            path: `/funds/${fundId.value}`,
            method: 'PATCH',
            body: { focus_areas: null },
        })
        toast.add({ title: "Using research's regional focus", color: 'success' })
    } catch (error) {
        toast.add({ title: 'Not saved', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isSavingTeam.value = false
    }
}

/**
 * Refresh this fund's research (fills gaps and updates what public sources show; never changes the
 * team's own fields or people's diligence answers).
 *
 * @returns Resolves once queued.
 */
async function refreshResearch() {
    isResearching.value = true
    try {
        fund.value = await api<FundDetail>({ path: `/funds/${fundId.value}/research`, method: 'POST' })
        toast.add({
            title: 'Refresh queued',
            description: 'New findings appear here as they are verified. Your own fields are never changed.',
            color: 'info',
        })
    } catch (error) {
        toast.add({ title: 'Refresh not queued', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isResearching.value = false
    }
}

/**
 * Archive the fund (hidden from the list, the map and the spider) or restore it.
 *
 * @returns Resolves once done.
 */
async function toggleArchived() {
    if (!fund.value) {
        return
    }
    isArchiving.value = true
    const action = fund.value.archived_at ? 'restore' : 'archive'
    try {
        fund.value = await api<FundDetail>({ path: `/funds/${fundId.value}/${action}`, method: 'POST' })
        toast.add({ title: action === 'archive' ? 'Fund archived' : 'Fund restored', color: 'success' })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isArchiving.value = false
    }
}

/**
 * Approve a fund the spider found: it joins the list, board and map, and its research is queued.
 *
 * @returns Resolves once done.
 */
async function approveFund() {
    isApproving.value = true
    try {
        fund.value = await api<FundDetail>({ path: `/funds/${fundId.value}/approve`, method: 'POST' })
        toast.add({ title: 'Fund approved', description: 'Its research is queued.', color: 'success' })
    } catch (error) {
        toast.add({ title: apiErrorMessage({ error }), color: 'error' })
    } finally {
        isApproving.value = false
    }
}

/**
 * Reject a wrong finding; the AI won't record it again.
 *
 * @param finding - The finding.
 * @returns Resolves once rejected.
 */
async function rejectFinding(finding: FundFinding) {
    busyFindingId.value = finding.id
    try {
        fund.value = await api<FundDetail>({ path: `/fund-findings/${finding.id}/reject`, method: 'POST' })
        toast.add({ title: 'Finding rejected', color: 'neutral' })
    } catch (error) {
        toast.add({ title: 'Not rejected', description: apiErrorMessage({ error }), color: 'error' })
    } finally {
        busyFindingId.value = null
    }
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar :title="fund?.name ?? 'Fund'">
                <template #leading>
                    <UDashboardSidebarCollapse />
                    <UButton
                        icon="i-lucide-arrow-left"
                        color="neutral"
                        variant="ghost"
                        to="/funds"
                        aria-label="Back to funds"
                    />
                </template>
                <template #right>
                    <UButton
                        v-if="fund"
                        :label="fund.archived_at ? 'Restore' : 'Archive'"
                        :icon="fund.archived_at ? 'i-lucide-archive-restore' : 'i-lucide-archive'"
                        color="neutral"
                        variant="ghost"
                        :loading="isArchiving"
                        @click="toggleArchived"
                    />
                    <FundsResearchStatusBadge v-if="fund" :status="fund.research_status" :error="fund.research_error" />
                    <UTooltip v-if="fund" text="A PDF of this profile for meeting prep">
                        <UButton
                            :to="`/v1/funds/${fund.id}/pdf`"
                            external
                            download
                            icon="i-lucide-file-down"
                            label="Download PDF"
                            color="neutral"
                        />
                    </UTooltip>
                    <UTooltip text="Re-research everything public sources show. Your own fields are never changed.">
                        <UButton
                            icon="i-lucide-refresh-cw"
                            label="Refresh data"
                            color="neutral"
                            :loading="isResearching"
                            :disabled="fund?.research_status === 'running' || fund?.research_status === 'queued'"
                            @click="refreshResearch"
                        />
                    </UTooltip>
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <UAlert
                v-if="loadError"
                color="error"
                variant="subtle"
                title="Couldn't load this fund"
                :description="loadError.message"
            />
            <div v-else-if="fund" class="space-y-6">
                <UAlert
                    v-if="fund.archived_at"
                    color="neutral"
                    icon="i-lucide-archive"
                    :title="fund.screened_out_at ? 'Screened out by the AI' : 'Archived'"
                    :description="
                        fund.screened_out_at
                            ? `${fund.screening_note ?? 'The AI judged this lender outside Earth Bank\'s focus.'} It is hidden from the Funds list and map, and isn't researched. Restore it to move it to pending approval.`
                            : 'This fund is hidden from the Funds list and map, and isn\'t researched. Restore it to bring it back.'
                    "
                />
                <UAlert
                    v-else-if="fund.approval_status === 'pending'"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-hourglass"
                    title="Pending approval"
                    :description="`The spider found this lender.${fund.screening_note ? ` AI screen: ${fund.screening_note}` : ''} It isn't researched or shown on the board or map until someone approves it. Archive it if it's outside Earth Bank's focus.`"
                    :actions="[
                        {
                            label: 'Approve',
                            icon: 'i-lucide-check',
                            variant: 'solid',
                            color: 'primary',
                            loading: isApproving,
                            onClick: approveFund,
                        },
                    ]"
                />
                <UCard>
                    <template #header>
                        <h2 class="font-semibold text-highlighted">At a glance</h2>
                    </template>
                    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
                        <div class="min-w-0 space-y-0.5">
                            <dt class="text-muted">Research <TermHint term="research_completeness" /></dt>
                            <dd><FundsCompletenessMeter :value="fund.research_completeness" /></dd>
                        </div>
                        <div class="min-w-0 space-y-0.5">
                            <dt class="text-muted">Diligence <TermHint term="diligence_completeness" /></dt>
                            <dd><FundsCompletenessMeter :value="fund.diligence_completeness" /></dd>
                        </div>
                        <div class="min-w-0 space-y-0.5">
                            <dt class="text-muted">AUM</dt>
                            <dd>{{ formatMoney({ cents: fund.aum_cents, compact: true }) }}</dd>
                        </div>
                        <div class="min-w-0 space-y-0.5">
                            <dt class="text-muted">Working capital <TermHint term="working_capital_loans" /></dt>
                            <dd>
                                {{
                                    fund.has_working_capital_loans
                                        ? fund.max_working_capital_loan_cents
                                            ? `Up to ${formatMoney({ cents: fund.max_working_capital_loan_cents, compact: true })}`
                                            : 'Yes'
                                        : '—'
                                }}
                            </dd>
                        </div>
                        <div class="min-w-0 space-y-0.5">
                            <dt class="text-muted">Headquarters</dt>
                            <dd>
                                {{
                                    [fund.hq_city, countryName({ code: fund.hq_country })].filter(Boolean).join(', ') ||
                                    '—'
                                }}
                            </dd>
                        </div>
                        <div class="min-w-0 space-y-0.5">
                            <dt class="text-muted">Website</dt>
                            <dd class="truncate">
                                <a
                                    v-if="fund.website_url"
                                    :href="fund.website_url"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="underline"
                                    >{{ displayUrl({ url: fund.website_url }) }}</a
                                >
                                <span v-else>—</span>
                            </dd>
                        </div>
                        <div class="min-w-0 space-y-0.5">
                            <dt class="text-muted">LinkedIn</dt>
                            <dd class="truncate">
                                <a
                                    v-if="fund.linkedin_url"
                                    :href="fund.linkedin_url"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="underline"
                                    >{{ displayUrl({ url: fund.linkedin_url, dropPrefix: 'linkedin.com/' }) }}</a
                                >
                                <span v-else>—</span>
                            </dd>
                        </div>
                        <div class="min-w-0 space-y-0.5">
                            <dt class="text-muted">Team size</dt>
                            <dd>
                                {{
                                    fund.employee_count !== null && !fund.employee_range
                                        ? fund.employee_count
                                        : (fund.employee_range ?? '—')
                                }}
                            </dd>
                        </div>
                        <div class="min-w-0 space-y-0.5">
                            <dt class="text-muted">Found</dt>
                            <dd>
                                {{ FUND_ORIGIN_LABELS[fund.origin] }}
                                <NuxtLink
                                    v-if="fund.discovered_from"
                                    :to="`/funds/${fund.discovered_from.id}`"
                                    class="block underline"
                                    >{{ fund.discovered_from.name }}</NuxtLink
                                >
                            </dd>
                        </div>
                    </dl>
                    <div class="mt-4 border-t border-default pt-4">
                        <p class="mb-2 text-sm text-muted">
                            Fit signals: {{ fund.fit_signals_met }} of 6 <TermHint term="fit_signals" />
                        </p>
                        <FundsFitSignals
                            :signals="fund.fit_signals"
                            list
                            class="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3"
                        />
                    </div>
                </UCard>
                <UTabs v-model="tab" :items="tabItems" :content="false" size="sm" />
                <div class="space-y-6">
                    <FundsIdentityCandidates
                        v-if="fund.identity_candidates.length"
                        :fund-id="fund.id"
                        :candidates="fund.identity_candidates"
                        @updated="updated => (fund = updated)"
                    />
                    <!-- Overview: research fields grouped; each value shows its sources and confidence. -->
                    <template v-if="tab === 'overview'">
                        <UCard v-for="group in ['basics', 'lending', 'model'] as FundResearchGroup[]" :key="group">
                            <template #header>
                                <div class="flex items-center justify-between">
                                    <h2 class="font-semibold text-highlighted">
                                        {{ FUND_RESEARCH_GROUP_LABELS[group] }}
                                    </h2>
                                    <UBadge
                                        label="AI research"
                                        color="info"
                                        variant="soft"
                                        size="sm"
                                        icon="i-lucide-sparkles"
                                    />
                                </div>
                            </template>
                            <dl class="divide-y divide-default">
                                <div
                                    v-for="field in fieldsInGroup({ group })"
                                    :key="field"
                                    class="grid gap-1 py-2 sm:grid-cols-3"
                                >
                                    <dt class="pt-2 text-sm text-muted">
                                        {{ FUND_RESEARCH_FIELD_DETAILS[field].label }}
                                    </dt>
                                    <dd class="sm:col-span-2">
                                        <template v-if="findingsByField.get(field)?.length">
                                            <FundsFindingValue
                                                v-for="finding in findingsByField.get(field)"
                                                :key="finding.id"
                                                :finding="finding"
                                                :is-busy="busyFindingId === finding.id"
                                                @reject="rejectFinding"
                                            />
                                        </template>
                                        <p v-else class="py-2 text-sm text-dimmed">Not found yet</p>
                                    </dd>
                                </div>
                            </dl>
                        </UCard>
                    </template>

                    <!-- Lists: deals, LPs, raises, public records / news, impact, conferences. -->
                    <template v-if="tab === 'track_record' || tab === 'presence'">
                        <UCard v-for="field in listFieldsForTab" :key="field">
                            <template #header>
                                <div class="flex items-center justify-between gap-2">
                                    <div>
                                        <h2 class="font-semibold text-highlighted">
                                            {{ FUND_RESEARCH_FIELD_DETAILS[field].label }}
                                        </h2>
                                        <p class="text-sm text-muted">{{ FUND_RESEARCH_FIELD_DETAILS[field].hint }}</p>
                                    </div>
                                    <UBadge
                                        :label="String(findingsByField.get(field)?.length ?? 0)"
                                        color="neutral"
                                        variant="soft"
                                    />
                                </div>
                            </template>
                            <div v-if="findingsByField.get(field)?.length" class="divide-y divide-default">
                                <FundsFindingValue
                                    v-for="finding in findingsByField.get(field)"
                                    :key="finding.id"
                                    :finding="finding"
                                    :is-busy="busyFindingId === finding.id"
                                    @reject="rejectFinding"
                                />
                            </div>
                            <p v-else class="text-sm text-dimmed">Nothing found yet.</p>
                        </UCard>
                    </template>

                    <template v-if="tab === 'team'">
                        <UCard>
                            <template #header>
                                <h2 class="font-semibold text-highlighted">People</h2>
                                <p class="text-sm text-muted">
                                    Principals first. Emails are only ones the fund publishes.
                                </p>
                            </template>
                            <ul v-if="fund.people.length" class="divide-y divide-default">
                                <li v-for="person in fund.people" :key="person.id" class="py-1">
                                    <!-- Collapsed to the name line; opening it shows the bio and work history. -->
                                    <UCollapsible :disabled="!person.bio_summary && !person.affiliations.length">
                                        <template #default="{ open }">
                                            <div
                                                class="flex cursor-pointer flex-wrap items-center gap-2 rounded-md py-2 hover:bg-elevated/50"
                                            >
                                                <UIcon
                                                    name="i-lucide-chevron-down"
                                                    class="size-4 shrink-0 text-dimmed transition-transform"
                                                    :class="{
                                                        'rotate-180': open,
                                                        invisible: !person.bio_summary && !person.affiliations.length,
                                                    }"
                                                />
                                                <span class="font-medium text-highlighted">{{ person.name }}</span>
                                                <FundsSourceChips :sources="person.sources" @click.stop />
                                                <UBadge
                                                    v-if="person.is_principal"
                                                    label="Principal"
                                                    color="primary"
                                                    variant="soft"
                                                    size="sm"
                                                />
                                                <span v-if="person.title" class="text-sm text-muted">{{
                                                    person.title
                                                }}</span>
                                                <UButton
                                                    v-if="person.linkedin_url"
                                                    :to="person.linkedin_url"
                                                    target="_blank"
                                                    icon="i-lucide-linkedin"
                                                    size="xs"
                                                    color="neutral"
                                                    variant="ghost"
                                                    aria-label="LinkedIn profile"
                                                    @click.stop
                                                />
                                                <a
                                                    v-if="person.email"
                                                    :href="`mailto:${person.email}`"
                                                    class="text-sm underline"
                                                    @click.stop
                                                    >{{ person.email }}</a
                                                >
                                                <span
                                                    v-if="person.affiliations.length && !open"
                                                    class="text-xs text-dimmed"
                                                    >Work history ({{ person.affiliations.length }})</span
                                                >
                                            </div>
                                        </template>
                                        <template #content>
                                            <div class="space-y-2 pb-3 pl-6">
                                                <p v-if="person.bio_summary" class="text-sm">
                                                    {{ person.bio_summary }}
                                                </p>
                                                <ul v-if="person.affiliations.length" class="space-y-1 text-sm">
                                                    <li
                                                        v-for="affiliation in person.affiliations"
                                                        :key="affiliation.id"
                                                        class="flex flex-wrap items-center gap-2"
                                                    >
                                                        <span class="text-muted">{{
                                                            relationLabels[affiliation.relation]
                                                        }}</span>
                                                        <NuxtLink
                                                            v-if="affiliation.organization.fund_id"
                                                            :to="`/funds/${affiliation.organization.fund_id}`"
                                                            class="font-medium hover:underline"
                                                            >{{ affiliation.organization.name }}</NuxtLink
                                                        >
                                                        <span v-else class="font-medium">{{
                                                            affiliation.organization.name
                                                        }}</span>
                                                        <span v-if="affiliation.title" class="text-muted">{{
                                                            affiliation.title
                                                        }}</span>
                                                        <span
                                                            v-if="affiliation.start_year || affiliation.end_year"
                                                            class="text-xs text-dimmed"
                                                            >{{ affiliation.start_year ?? '?' }}–{{
                                                                affiliation.end_year ?? 'now'
                                                            }}</span
                                                        >
                                                        <FundsSourceChips :sources="affiliation.sources" />
                                                    </li>
                                                </ul>
                                            </div>
                                        </template>
                                    </UCollapsible>
                                </li>
                            </ul>
                            <p v-else class="text-sm text-dimmed">No team members found yet.</p>
                        </UCard>
                        <UCard>
                            <template #header>
                                <h2 class="font-semibold text-highlighted">Network</h2>
                                <p class="text-sm text-muted">
                                    Where the team worked and studied, and other funds on the list that share those
                                    places. Click a fund to open it.
                                </p>
                            </template>
                            <ClientOnly>
                                <FundsNetworkGraph v-if="network && network.nodes.length > 1" :network="network" />
                                <p v-else class="text-sm text-dimmed">No work history found yet.</p>
                            </ClientOnly>
                        </UCard>
                    </template>

                    <!-- Due diligence: the team's own fields and answers, kept apart from AI research. -->
                    <template v-if="tab === 'diligence'">
                        <FundsDiligenceGaps
                            :fund-id="fund.id"
                            :items="fund.diligence"
                            @saved="updated => (fund = updated)"
                        />
                        <UCard>
                            <template #header>
                                <div class="flex items-center justify-between">
                                    <h2 class="font-semibold text-highlighted">Tracking</h2>
                                    <UBadge
                                        label="Entered by people"
                                        color="primary"
                                        variant="soft"
                                        size="sm"
                                        icon="i-lucide-user-pen"
                                    />
                                </div>
                            </template>
                            <div class="grid gap-4 sm:grid-cols-2">
                                <UFormField label="Website" hint="Correcting it refreshes the research">
                                    <UInput v-model="teamForm.website_url" placeholder="https://…" class="w-full" />
                                </UFormField>
                                <UFormField label="LinkedIn page">
                                    <UInput
                                        v-model="teamForm.linkedin_url"
                                        placeholder="https://www.linkedin.com/company/…"
                                        class="w-full"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Regional focus"
                                    :hint="fund?.is_focus_set_by_team ? 'Set by the team' : 'From research'"
                                >
                                    <USelectMenu
                                        v-model="teamForm.focus_areas"
                                        :items="focusItems"
                                        value-key="value"
                                        multiple
                                        placeholder="Add regions or countries"
                                        class="w-full"
                                    >
                                        <FundsFocusTags
                                            v-if="teamForm.focus_areas.length"
                                            :codes="teamForm.focus_areas"
                                            :max="8"
                                        />
                                        <span v-else class="text-dimmed">Add regions or countries</span>
                                    </USelectMenu>
                                    <UButton
                                        v-if="fund?.is_focus_set_by_team"
                                        label="Use research's focus instead"
                                        size="xs"
                                        color="neutral"
                                        variant="link"
                                        class="mt-1 px-0"
                                        :loading="isSavingTeam"
                                        @click="useResearchFocus"
                                    />
                                </UFormField>
                                <UFormField label="Stage">
                                    <USelect v-model="teamForm.stage" :items="stageItems" class="w-full" />
                                </UFormField>
                                <UFormField label="Fit">
                                    <USelectMenu
                                        v-model="teamForm.fit_tags"
                                        :items="fitTagItems"
                                        value-key="value"
                                        multiple
                                        class="w-full"
                                        placeholder="Add a tag"
                                    />
                                </UFormField>
                                <UFormField label="Owner">
                                    <USelect v-model="teamForm.owner_id" :items="ownerItems" class="w-full" />
                                </UFormField>
                                <UFormField label="Notes / flags" class="sm:col-span-2">
                                    <UTextarea v-model="teamForm.notes" :rows="4" autoresize class="w-full" />
                                </UFormField>
                                <UButton
                                    label="Save"
                                    variant="solid"
                                    class="justify-self-start sm:col-span-2"
                                    :loading="isSavingTeam"
                                    @click="saveTeamFields"
                                />
                            </div>
                        </UCard>
                    </template>

                    <FundsNoteImport
                        v-if="fund && tab === 'import'"
                        :fund-id="fund.id"
                        :notes="fund.imported_notes"
                        :highlighted-note-id="highlightedNoteId"
                        @imported="updated => (fund = updated)"
                    />

                    <template v-if="fund && tab === 'sources'">
                        <UCard>
                            <template #header>
                                <h2 class="font-semibold text-highlighted">
                                    Sources <TermHint term="research_sources" />
                                </h2>
                                <p class="text-sm text-muted">Every page a fact on this profile was read from.</p>
                            </template>
                            <ul v-if="allSources.length" class="divide-y divide-default">
                                <li
                                    v-for="source in allSources"
                                    :key="source.id"
                                    class="flex items-start justify-between gap-3 py-2"
                                >
                                    <div class="min-w-0">
                                        <a
                                            :href="source.url"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class="text-sm font-medium hover:underline"
                                            >{{ source.title ?? source.url }}</a
                                        >
                                        <p class="truncate text-xs text-muted">{{ source.url }}</p>
                                    </div>
                                    <div class="flex shrink-0 items-center gap-2 text-xs text-muted">
                                        <UBadge
                                            :label="FUND_SOURCE_KIND_LABELS[source.kind]"
                                            color="neutral"
                                            variant="soft"
                                            size="sm"
                                        />
                                        <span>{{ source.uses }} fact{{ source.uses > 1 ? 's' : '' }}</span>
                                    </div>
                                </li>
                            </ul>
                            <p v-else class="text-sm text-dimmed">No sources yet.</p>
                        </UCard>
                        <UCard>
                            <template #header>
                                <h2 class="font-semibold text-highlighted">Research runs</h2>
                                <p class="text-sm text-muted">
                                    Findings the app couldn't verify against a fetched page are dropped.
                                </p>
                            </template>
                            <ul v-if="fund.runs.length" class="divide-y divide-default text-sm">
                                <li
                                    v-for="run in fund.runs"
                                    :key="run.id"
                                    class="flex flex-wrap items-center justify-between gap-2 py-2"
                                >
                                    <span>{{ formatDateTime({ value: run.started_at }) }}</span>
                                    <span class="text-muted">
                                        {{ run.web_searches }} searches · {{ run.web_fetches }} pages ·{{
                                            run.firecrawl_credits ? ` ${run.firecrawl_credits} Firecrawl credits ·` : ''
                                        }}
                                        {{ run.findings_added }} kept · {{ run.findings_dropped }} dropped ·
                                        {{ run.funds_discovered }} new funds · ${{ run.cost_usd.toFixed(2) }}
                                    </span>
                                    <UBadge
                                        :label="run.status"
                                        :color="
                                            run.status === 'done'
                                                ? 'success'
                                                : run.status === 'failed'
                                                  ? 'error'
                                                  : 'neutral'
                                        "
                                        variant="soft"
                                        size="sm"
                                    />
                                    <p v-if="run.error" class="w-full text-xs text-error">{{ run.error }}</p>
                                </li>
                            </ul>
                            <p v-else class="text-sm text-dimmed">Not researched yet.</p>
                        </UCard>
                    </template>
                </div>
            </div>
        </template>
    </UDashboardPanel>
</template>
