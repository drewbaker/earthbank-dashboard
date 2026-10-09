<script setup lang="ts">
import { computed } from 'vue'
import type { MailboxSyncStatus } from '#shared/schemas/index.ts'
import { formatRelativeTime } from '~/utils/format.ts'

const props = defineProps<{ sync: MailboxSyncStatus; isFirstSync: boolean }>()

const PHASES = ['searching', 'checking', 'reading'] as const
const PHASE_LABELS: Record<(typeof PHASES)[number], string> = {
    searching: 'Searching Gmail for funder email',
    checking: 'Checking which emails are with funders',
    reading: 'Reading funder emails and updating the pipeline',
}

const step = computed(() => (props.sync.phase ? PHASES.indexOf(props.sync.phase) + 1 : 0))

const detail = computed(() => {
    const { phase, done, total } = props.sync
    if (!phase || total === null) {
        return null
    }
    if (phase === 'searching') {
        return `Search ${Math.min(done + 1, total)} of ${total}`
    }
    if (phase === 'checking') {
        return `${done} of ${total} emails checked`
    }
    return total === 0 ? 'No new funder email' : `${done} of ${total} emails read`
})

// Each phase is a third of the bar; within a phase, the share of its items done.
const percent = computed(() => {
    if (props.sync.state !== 'running' || !props.sync.phase) {
        return null
    }
    const within = props.sync.total ? props.sync.done / props.sync.total : 0
    return Math.round(((step.value - 1 + within) / PHASES.length) * 100)
})

const lastResultText = computed(() => {
    const result = props.sync.last_result
    if (!result) {
        return null
    }
    if (result.processed === 0) {
        return 'No new funder email.'
    }
    const parts = [`Read ${result.processed} new funder email${result.processed === 1 ? '' : 's'}`]
    if (result.applied) {
        parts.push(`${result.applied} pipeline update${result.applied === 1 ? '' : 's'} applied`)
    }
    if (result.pending) {
        parts.push(`${result.pending} waiting for review on Activity`)
    }
    const remaining = result.matched - result.processed
    if (remaining > 0) {
        parts.push(`${remaining} more will be read on the next syncs`)
    }
    return `${parts.join(', ')}.`
})
</script>

<template>
    <div class="space-y-2 text-sm">
        <template v-if="sync.state === 'queued'">
            <div class="flex items-center gap-2 text-highlighted">
                <UIcon name="i-lucide-hourglass" class="size-4 text-muted" />
                Waiting to start…
            </div>
            <p class="text-xs text-muted">
                Starts within a minute, or after any other mailbox sync that's running finishes.
            </p>
        </template>

        <template v-else-if="sync.state === 'running'">
            <div class="flex items-center justify-between gap-2">
                <span class="flex items-center gap-2 text-highlighted">
                    <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-primary" />
                    {{ sync.phase ? PHASE_LABELS[sync.phase] : 'Starting' }}
                </span>
                <span class="text-xs text-muted">Step {{ step }} of 3</span>
            </div>
            <UProgress :model-value="percent" size="sm" />
            <p class="text-xs text-muted">
                {{ detail }}
                <template v-if="sync.started_at">
                    · started {{ formatRelativeTime({ value: sync.started_at }) }}</template
                >
                <template v-if="isFirstSync">
                    · the first sync reads the last 90 days, so it can take a few minutes</template
                >
            </p>
        </template>

        <p v-else-if="sync.last_result" class="flex items-start gap-2 text-muted">
            <UIcon name="i-lucide-circle-check" class="mt-0.5 size-4 shrink-0 text-success" />
            <span>
                Last sync {{ formatRelativeTime({ value: sync.last_result.finished_at }) }}: {{ lastResultText }}
            </span>
        </p>
    </div>
</template>
