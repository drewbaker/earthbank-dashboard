<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { formatFileSize } from '~/utils/format.ts'

// Files picked but not uploaded yet (they upload when the task or comment is saved).
const files = defineModel<File[]>({ required: true })
defineProps<{ label?: string }>()

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

/**
 * Add the picked files to the list.
 *
 * File input `change` handler, so it takes the DOM event.
 *
 * @param event - The change event.
 * @returns Nothing.
 */
function addFiles(event: Event) {
    const input = event.target as HTMLInputElement
    files.value = [...files.value, ...(input.files ?? [])]
    input.value = ''
}

/**
 * Drop one file from the list.
 *
 * @param input.index - Its position.
 * @returns Nothing.
 */
function removeFile({ index }: { index: number }) {
    files.value = files.value.filter((_, position) => position !== index)
}
</script>

<template>
    <div class="flex flex-wrap items-center gap-2">
        <UButton
            :label="label ?? 'Attach files'"
            icon="i-lucide-paperclip"
            size="xs"
            color="neutral"
            @click="fileInput?.click()"
        />
        <input ref="fileInput" type="file" multiple class="hidden" @change="addFiles" />
        <UBadge
            v-for="(file, index) in files"
            :key="`${file.name}-${index}`"
            color="neutral"
            variant="outline"
            class="max-w-full gap-1"
        >
            <span class="truncate">{{ file.name }}</span>
            <span class="text-dimmed">{{ formatFileSize({ bytes: file.size }) }}</span>
            <UButton
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                variant="link"
                class="-my-1 p-0"
                :aria-label="`Remove ${file.name}`"
                @click="removeFile({ index })"
            />
        </UBadge>
    </div>
</template>
