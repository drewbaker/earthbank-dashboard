import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/** One row from a public list, ready to store. */
export type PublicInvestmentRow = {
    externalId: string
    url: string | null
    recipientName: string
    recipientNameKey: string
    amountCents: bigint | null
    currency: string | null
    originalAmount: number | null
    committedOn: Date | null
    country: string | null
    instrument: string | null
    description: string | null
    isIntermediary: boolean
}

/**
 * Store or refresh rows from one public list (keyed by the institution's own id).
 *
 * @param input.sourceKey - The list.
 * @param input.rows - Rows read.
 * @param input.now - Current time.
 * @returns How many rows were new.
 */
export async function upsertPublicInvestmentRecords({
    sourceKey,
    rows,
    now,
}: {
    sourceKey: string
    rows: PublicInvestmentRow[]
    now: Date
}) {
    let created = 0
    for (const row of rows) {
        const data = {
            url: row.url,
            recipient_name: row.recipientName,
            recipient_name_key: row.recipientNameKey,
            amount_cents: row.amountCents,
            currency: row.currency,
            original_amount: row.originalAmount,
            committed_on: row.committedOn,
            country: row.country,
            instrument: row.instrument,
            description: row.description,
            is_intermediary: row.isIntermediary,
        }
        const existing = await db().publicInvestmentRecord.findUnique({
            where: { source_key_external_id: { source_key: sourceKey, external_id: row.externalId } },
            select: { id: true },
        })
        if (existing) {
            await db().publicInvestmentRecord.update({ where: { id: existing.id }, data })
        } else {
            await db().publicInvestmentRecord.create({
                data: {
                    id: newId({ kind: 'publicInvestmentRecord', now: now.getTime() }),
                    source_key: sourceKey,
                    external_id: row.externalId,
                    ...data,
                },
            })
            created += 1
        }
    }
    return created
}

/**
 * Public records whose recipient has this name key (cross-referencing a fund).
 *
 * @param input.nameKey - The fund's normalized name.
 * @returns Matching records.
 */
export function listPublicRecordsByRecipient({ nameKey }: { nameKey: string }) {
    return db().publicInvestmentRecord.findMany({
        where: { recipient_name_key: nameKey },
        orderBy: { committed_on: 'desc' },
        take: 100,
    })
}

/**
 * Mark records as belonging to a fund.
 *
 * @param input.recordIds - The records.
 * @param input.fundManagerId - The fund.
 * @returns The update count.
 */
export function assignPublicRecordsToFund({
    recordIds,
    fundManagerId,
}: {
    recordIds: string[]
    fundManagerId: string
}) {
    return db().publicInvestmentRecord.updateMany({
        where: { id: { in: recordIds } },
        data: { fund_manager_id: fundManagerId },
    })
}

/**
 * Intermediary recipients on a list that no fund matches yet (spider candidates).
 *
 * @param input.sourceKey - The list.
 * @param input.limit - Most names.
 * @returns Distinct recipient names with a sample description.
 */
export async function listUnmatchedIntermediaries({ sourceKey, limit }: { sourceKey: string; limit: number }) {
    const rows = await db().publicInvestmentRecord.findMany({
        where: { source_key: sourceKey, is_intermediary: true, fund_manager_id: null },
        select: { recipient_name: true, recipient_name_key: true, description: true },
        orderBy: { committed_on: 'desc' },
        take: limit * 3,
    })
    const unique = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
        if (!unique.has(row.recipient_name_key)) {
            unique.set(row.recipient_name_key, row)
        }
    }
    return [...unique.values()].slice(0, limit)
}

/**
 * Sync state for every list that has run at least once.
 *
 * @returns Source rows.
 */
export function listPublicInvestmentSourceStates() {
    return db().publicInvestmentSource.findMany()
}

/**
 * Read one list's sync state.
 *
 * @param input.key - The list.
 * @returns The state row, or null before its first sync.
 */
export function findPublicInvestmentSourceState({ key }: { key: string }) {
    return db().publicInvestmentSource.findUnique({ where: { key } })
}

/**
 * Update one list's sync state.
 *
 * @param input.key - The list.
 * @param input.data - Fields to set.
 * @returns The state row.
 */
export function savePublicInvestmentSourceState({
    key,
    data,
}: {
    key: string
    data: { status?: string; cursor?: string | null; last_synced_at?: Date; last_error?: string | null }
}) {
    return db().publicInvestmentSource.upsert({ where: { key }, create: { key, ...data }, update: data })
}

/**
 * Count stored rows per list.
 *
 * @returns List key → row count.
 */
export async function countPublicRecordsBySource() {
    const groups = await db().publicInvestmentRecord.groupBy({ by: ['source_key'], _count: { _all: true } })
    return new Map(groups.map(group => [group.source_key, group._count._all]))
}
