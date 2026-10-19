import { defineRouteMeta } from 'nitropack/runtime'
import { countPublicRecordsBySource, listPublicInvestmentSourceStates } from '#server/database/public-investments.ts'
import { defineApiHandler } from '#server/utils/api.ts'
import { requireUser } from '#server/utils/auth.ts'
import { toIsoDateTime } from '#server/utils/dates.ts'
import { PUBLIC_INVESTMENT_SOURCES } from '#server/utils/funds/public-investment-sources.ts'
import type { PublicInvestmentSource } from '#shared/schemas/index.ts'

defineRouteMeta({
    openAPI: {
        tags: ['Funds'],
        summary: 'Public investment lists',
        description:
            'The DFI, multilateral and US government lists fund research cross-references, with their sync state.',
        responses: {
            200: {
                description: 'Lists',
                content: {
                    'application/json': { schema: { $ref: '#/components/schemas/PublicInvestmentSourceList' } },
                },
            },
        },
    },
})

export default defineApiHandler(async event => {
    requireUser({ event })
    const [states, counts] = await Promise.all([listPublicInvestmentSourceStates(), countPublicRecordsBySource()])
    const stateByKey = new Map(states.map(state => [state.key, state]))
    const data: PublicInvestmentSource[] = PUBLIC_INVESTMENT_SOURCES.map(source => {
        const state = stateByKey.get(source.key)
        return {
            key: source.key,
            label: source.label,
            publisher_kind: source.publisherKind,
            url: source.url,
            feeds_spider: source.feedsSpider !== false,
            status: (state?.status as PublicInvestmentSource['status'] | undefined) ?? 'idle',
            last_synced_at: toIsoDateTime({ date: state?.last_synced_at }),
            records: counts.get(source.key) ?? 0,
            last_error: state?.last_error ?? null,
        }
    })
    return { data, next_cursor: null, has_more: false }
})
