import { saveResearchResults } from '#server/database/fund-research.ts'
import { assignPublicRecordsToFund, listPublicRecordsByRecipient } from '#server/database/public-investments.ts'
import { findingValueKey } from '#server/utils/funds/verify-finding.ts'
import { findPublicInvestmentSource } from '#server/utils/funds/public-investment-sources.ts'

// A name match is strong but not certain (two lenders can share a name), so it isn't 1.0.
const NAME_MATCH_CONFIDENCE = 0.9

/**
 * Cross-reference a fund with the stored DFI and government records: records whose recipient has the
 * fund's normalized name become `public_record` findings, linked to the record's own page.
 *
 * @param input.fundManagerId - The fund.
 * @param input.nameKey - Its normalized name.
 * @param input.researchRunId - The run doing this, or null when a list sync does it.
 * @param input.now - Current time.
 * @returns How many records matched.
 */
export async function matchPublicRecordsToFund({
    fundManagerId,
    nameKey,
    researchRunId,
    now,
}: {
    fundManagerId: string
    nameKey: string
    researchRunId: string | null
    now: Date
}) {
    const records = await listPublicRecordsByRecipient({ nameKey })
    if (records.length === 0) {
        return 0
    }
    await assignPublicRecordsToFund({ recordIds: records.map(record => record.id), fundManagerId })
    await saveResearchResults({
        fundManagerId,
        researchRunId,
        findings: records.map(record => {
            const source = findPublicInvestmentSource({ key: record.source_key })
            const value = {
                source_key: record.source_key,
                source_label: source?.label ?? record.source_key,
                record_id: record.external_id,
                recipient: record.recipient_name,
                amount:
                    record.original_amount !== null && record.currency
                        ? { amount: record.original_amount, currency: record.currency }
                        : null,
                committed_on: record.committed_on?.toISOString().slice(0, 10) ?? null,
                description: record.description,
            }
            return {
                field: 'public_record' as const,
                value,
                valueKey: findingValueKey({ field: 'public_record', value }),
                isList: true,
                confidence: NAME_MATCH_CONFIDENCE,
                sources: [
                    {
                        url: record.url ?? source?.url ?? '',
                        title: `${source?.label ?? record.source_key}: ${record.recipient_name}`,
                        kind:
                            source?.publisherKind === 'us_government'
                                ? ('government_database' as const)
                                : ('dfi_database' as const),
                        quote: null,
                    },
                ].filter(link => link.url),
            }
        }),
        people: [],
        affiliations: [],
        diligence: [],
        now,
    })
    return records.length
}
