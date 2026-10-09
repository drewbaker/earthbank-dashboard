<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'

// A whole-dollar amount input that shows "$200,000" while you type (not just after leaving the
// field), keeping the cursor where it was. The model is dollars, or undefined when empty.

const dollars = defineModel<number | undefined>()
defineProps<{ placeholder?: string }>()

const FORMATTER = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const MAX_DOLLARS = 999_999_999_999

const input = useTemplateRef<{ inputRef: HTMLInputElement | null }>('input')
const text = ref(formatDollars({ value: dollars.value }))

// Outside changes (a form reset, loading a record) re-format the text.
watch(dollars, value => {
    if (parseDollars({ text: text.value }) !== value) {
        text.value = formatDollars({ value })
    }
})

/**
 * Re-format as the person types: keep the digits, add "$" and commas, and put the cursor back after
 * the same digit it followed.
 *
 * `UInput`'s update handler, so it takes the raw text.
 *
 * @param raw - What's in the field now.
 * @returns Nothing.
 */
function updateFromText(raw: string | number) {
    const value = String(raw)
    const element = input.value?.inputRef ?? null
    const caret = element?.selectionStart ?? value.length
    const digitsBeforeCaret = value.slice(0, caret).replace(/\D/g, '').length
    const amount = parseDollars({ text: value })
    const formatted = formatDollars({ value: amount })
    text.value = formatted
    dollars.value = amount
    if (element) {
        // The input may already show this text, so set it directly before moving the cursor.
        element.value = formatted
        let position = 0
        for (let seen = 0; position < formatted.length && seen < digitsBeforeCaret; position++) {
            if (/\d/.test(formatted[position]!)) {
                seen++
            }
        }
        const cursor = digitsBeforeCaret === 0 ? Math.min(1, formatted.length) : position
        void nextTick(() => element.setSelectionRange(cursor, cursor))
    }
}

/**
 * "$200,000", or empty for no amount.
 *
 * @param input.value - Whole dollars.
 * @returns The text.
 */
function formatDollars({ value }: { value: number | undefined }) {
    return value === undefined ? '' : FORMATTER.format(value)
}

/**
 * Whole dollars from typed text, ignoring "$", commas and anything else that isn't a digit.
 *
 * @param input.text - The text.
 * @returns Dollars, or undefined when there are no digits.
 */
function parseDollars({ text }: { text: string }) {
    const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
    return digits ? Math.min(MAX_DOLLARS, Number(digits)) : undefined
}
</script>

<template>
    <UInput
        ref="input"
        :model-value="text"
        inputmode="numeric"
        autocomplete="off"
        :placeholder="placeholder ?? '$0'"
        class="w-full"
        @update:model-value="updateFromText"
    />
</template>
