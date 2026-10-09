<script setup lang="ts">
defineProps<{ title: string; description: string; phase: number }>()
</script>

<template>
    <UEmpty icon="i-lucide-hammer" :title="title" :description="description">
        <template #actions>
            <UBadge color="neutral" :label="`Coming in phase ${phase}`" />
        </template>
    </UEmpty>
</template>
