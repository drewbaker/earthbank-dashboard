import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        // Integration tests each own a temporary DATA_DIR; run files one at a time so env vars don't collide.
        fileParallelism: false,
    },
})
