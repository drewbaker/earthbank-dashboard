import { BookeepingAiProvider } from '#server/utils/bookkeeping/bookeeping-ai.ts'
import type { BookkeepingProvider } from '#server/utils/bookkeeping/types.ts'
import { config } from '#server/utils/config.ts'

/**
 * The configured bank-data provider, or null when no API key is set (the dashboard then uses the
 * manual balance and burn from Settings → Cash).
 *
 * @returns The provider, or null.
 */
export function bookkeepingProvider(): BookkeepingProvider | null {
    return config.bookkeepingApiKey
        ? new BookeepingAiProvider({ apiBase: config.bookkeepingApiBase, apiKey: config.bookkeepingApiKey })
        : null
}
