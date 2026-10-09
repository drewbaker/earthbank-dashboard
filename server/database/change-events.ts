import { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'
import type { ChangeSource, ChangeStatus } from '#shared/constants/pipeline.ts'
import type { ChangeEntityType } from '#shared/schemas/index.ts'

export type ChangeEventDraft = {
    field: string
    fromValue: Prisma.InputJsonValue | null
    toValue: Prisma.InputJsonValue | null
}

export const CHANGE_EVENT_INCLUDE = { actor_user: true, resolved_by_user: true } satisfies Prisma.ChangeEventInclude

export type ChangeEventRow = Prisma.ChangeEventGetPayload<{ include: typeof CHANGE_EVENT_INCLUDE }>

/**
 * Update an entity and record one change event per field, in one transaction.
 *
 * @param input.entityType - `funder` or `opportunity`.
 * @param input.entityId - The record being changed.
 * @param input.columnUpdates - Columns to write; empty when only recording pending suggestions.
 * @param input.drafts - One entry per changed field, with JSON from/to values.
 * @param input.source - Where the change came from.
 * @param input.status - `applied`, or `pending` for suggestions that wait for review.
 * @param input.actorUserId - The user who made it, or null for imports and AI.
 * @param input.evidenceId - Email evidence that caused it, if any.
 * @param input.reason - Why it changed (AI reasoning, revert note).
 * @param input.confidence - AI confidence 0–1, if any.
 * @returns The created change event rows.
 */
export async function writeFieldChanges({
    entityType,
    entityId,
    columnUpdates,
    drafts,
    source,
    status,
    actorUserId,
    evidenceId,
    reason,
    confidence,
}: {
    entityType: ChangeEntityType
    entityId: string
    columnUpdates: Record<string, unknown>
    drafts: ChangeEventDraft[]
    source: ChangeSource
    status: ChangeStatus
    actorUserId: string | null
    evidenceId: string | null
    reason: string | null
    confidence: number | null
}) {
    const eventIds = drafts.map(() => newId({ kind: 'changeEvent' }))
    const writes: Prisma.PrismaPromise<unknown>[] = []
    if (status === 'applied' && Object.keys(columnUpdates).length > 0) {
        writes.push(updateEntity({ entityType, entityId, data: columnUpdates }))
    }
    for (const [index, draft] of drafts.entries()) {
        writes.push(
            db().changeEvent.create({
                data: {
                    id: eventIds[index]!,
                    entity_type: entityType,
                    entity_id: entityId,
                    field: draft.field,
                    from_value: draft.fromValue ?? undefined,
                    to_value: draft.toValue ?? undefined,
                    source,
                    status,
                    actor_user_id: actorUserId,
                    evidence_id: evidenceId,
                    reason,
                    confidence,
                },
            }),
        )
    }
    await db().$transaction(writes)
    const events = await db().changeEvent.findMany({ where: { id: { in: eventIds } }, include: CHANGE_EVENT_INCLUDE })
    return events.sort((first, second) => eventIds.indexOf(first.id) - eventIds.indexOf(second.id))
}

/**
 * Mark a change event resolved (accepted, rejected or reverted), optionally updating its entity in
 * the same transaction.
 *
 * @param input.changeEventId - The event.
 * @param input.status - New status.
 * @param input.resolvedByUserId - Who resolved it.
 * @param input.resolvedAt - When.
 * @param input.fromValue - Replacement from-value (accepting a pending change records the value it replaced).
 * @param input.entityUpdate - Columns to write on the entity, if any.
 * @returns Resolves once written.
 */
export async function resolveChangeEvent({
    changeEventId,
    status,
    resolvedByUserId,
    resolvedAt,
    fromValue,
    entityUpdate,
}: {
    changeEventId: string
    status: ChangeStatus
    resolvedByUserId: string | null
    resolvedAt: Date
    fromValue?: Prisma.InputJsonValue | null
    entityUpdate?: { entityType: ChangeEntityType; entityId: string; data: Record<string, unknown> }
}) {
    const writes: Prisma.PrismaPromise<unknown>[] = []
    if (entityUpdate) {
        writes.push(updateEntity(entityUpdate))
    }
    writes.push(
        db().changeEvent.update({
            where: { id: changeEventId },
            data: {
                status,
                resolved_at: resolvedAt,
                resolved_by_user_id: resolvedByUserId,
                // A null from-value must be written as SQL NULL; undefined would keep the stale value.
                from_value: fromValue === undefined ? undefined : fromValue === null ? Prisma.DbNull : fromValue,
            },
        }),
    )
    await db().$transaction(writes)
}

/**
 * Find a change event with its users.
 *
 * @param input.changeEventId - The event.
 * @returns The event, or null.
 */
export function findChangeEvent({ changeEventId }: { changeEventId: string }) {
    return db().changeEvent.findUnique({ where: { id: changeEventId }, include: CHANGE_EVENT_INCLUDE })
}

/**
 * List change events, newest first, with cursor pagination.
 *
 * @param input.entityType - Only this entity type.
 * @param input.entityIds - Only these entities (e.g. a funder and its opportunities).
 * @param input.source - Only this source.
 * @param input.status - Only this status.
 * @param input.cursor - Return events older than this id.
 * @param input.limit - Page size.
 * @returns Up to `limit + 1` events (the extra one tells the caller there's more).
 */
export function listChangeEventRows({
    entityType,
    entityIds,
    source,
    status,
    cursor,
    limit,
}: {
    entityType?: ChangeEntityType
    entityIds?: string[]
    source?: ChangeSource
    status?: ChangeStatus
    cursor?: string
    limit: number
}) {
    return db().changeEvent.findMany({
        where: {
            entity_type: entityType,
            entity_id: entityIds ? { in: entityIds } : undefined,
            source,
            status,
            id: cursor ? { lt: cursor } : undefined,
        },
        include: CHANGE_EVENT_INCLUDE,
        orderBy: { id: 'desc' },
        take: limit + 1,
    })
}

/**
 * Count change events waiting for review.
 *
 * @returns The number of pending events.
 */
export function countPendingChangeEvents() {
    return db().changeEvent.count({ where: { status: 'pending' } })
}

/**
 * When a field was last changed by hand (applied manual edits only).
 *
 * @param input.entityType - `funder` or `opportunity`.
 * @param input.entityId - The record.
 * @param input.field - The field.
 * @returns The time of the latest manual change, or null.
 */
export async function latestManualChangeAt({
    entityType,
    entityId,
    field,
}: {
    entityType: ChangeEntityType
    entityId: string
    field: string
}) {
    const latest = await db().changeEvent.findFirst({
        // Instructions someone emailed in are their own edits too, so they also win over AI reading mail.
        where: {
            entity_type: entityType,
            entity_id: entityId,
            field,
            source: { in: ['manual', 'ai_instruction'] },
            status: 'applied',
        },
        orderBy: { id: 'desc' },
        select: { created_at: true },
    })
    return latest?.created_at ?? null
}

/**
 * Update a funder or opportunity row.
 *
 * @param input.entityType - Which table.
 * @param input.entityId - The row.
 * @param input.data - Columns to set.
 * @returns The pending Prisma update (for use in a transaction).
 */
function updateEntity({
    entityType,
    entityId,
    data,
}: {
    entityType: ChangeEntityType
    entityId: string
    data: Record<string, unknown>
}) {
    return entityType === 'funder'
        ? db().funder.update({ where: { id: entityId }, data: data as Prisma.FunderUncheckedUpdateInput })
        : db().opportunity.update({ where: { id: entityId }, data: data as Prisma.OpportunityUncheckedUpdateInput })
}

/**
 * When a field was last changed by anything other than the spreadsheet import (people, or AI
 * changes that were applied).
 *
 * @param input.entityType - `funder` or `opportunity`.
 * @param input.entityId - The record.
 * @param input.field - The field.
 * @returns The time of the latest such change, or null.
 */
export async function latestNonImportChangeAt({
    entityType,
    entityId,
    field,
}: {
    entityType: ChangeEntityType
    entityId: string
    field: string
}) {
    const latest = await db().changeEvent.findFirst({
        where: { entity_type: entityType, entity_id: entityId, field, source: { not: 'import' }, status: 'applied' },
        orderBy: { id: 'desc' },
        select: { created_at: true },
    })
    return latest?.created_at ?? null
}

/**
 * Revert an applied change in one transaction: write the earlier value back, log that as a manual
 * change, and mark the original reverted.
 *
 * @param input.changeEventId - The applied event.
 * @param input.entityType - `funder` or `opportunity`.
 * @param input.entityId - The record.
 * @param input.columnUpdates - Columns that restore the earlier value.
 * @param input.draft - The revert's own change (field, from, to).
 * @param input.actorUserId - Who reverted it.
 * @param input.resolvedAt - When.
 * @returns Resolves once written.
 */
export async function writeRevert({
    changeEventId,
    entityType,
    entityId,
    columnUpdates,
    draft,
    actorUserId,
    resolvedAt,
}: {
    changeEventId: string
    entityType: ChangeEntityType
    entityId: string
    columnUpdates: Record<string, unknown>
    draft: ChangeEventDraft
    actorUserId: string
    resolvedAt: Date
}) {
    await db().$transaction([
        updateEntity({ entityType, entityId, data: columnUpdates }),
        db().changeEvent.create({
            data: {
                id: newId({ kind: 'changeEvent' }),
                entity_type: entityType,
                entity_id: entityId,
                field: draft.field,
                from_value: draft.fromValue ?? undefined,
                to_value: draft.toValue ?? undefined,
                source: 'manual',
                status: 'applied',
                actor_user_id: actorUserId,
                reason: `Reverted change ${changeEventId}`,
            },
        }),
        db().changeEvent.update({
            where: { id: changeEventId },
            data: { status: 'reverted', resolved_at: resolvedAt, resolved_by_user_id: actorUserId },
        }),
    ])
}

/**
 * The changes that compete over one field: pending suggestions, and applied changes other than the
 * spreadsheet import, each with the date of the email behind it (if any).
 *
 * @param input.entityType - `funder` or `opportunity`.
 * @param input.entityId - The record.
 * @param input.field - The field.
 * @returns The events, oldest first.
 */
export function listCompetingFieldChanges({
    entityType,
    entityId,
    field,
}: {
    entityType: ChangeEntityType
    entityId: string
    field: string
}) {
    return db().changeEvent.findMany({
        where: {
            entity_type: entityType,
            entity_id: entityId,
            field,
            OR: [{ status: 'pending' }, { status: 'applied', source: { not: 'import' } }],
        },
        select: {
            id: true,
            status: true,
            to_value: true,
            created_at: true,
            evidence: { select: { sent_at: true } },
        },
        orderBy: { id: 'asc' },
    })
}

/**
 * Every record and field that has a suggestion waiting for review.
 *
 * @returns Distinct entity/field pairs.
 */
export function listPendingChangeFields() {
    return db().changeEvent.findMany({
        where: { status: 'pending' },
        distinct: ['entity_type', 'entity_id', 'field'],
        select: { entity_type: true, entity_id: true, field: true },
    })
}

/**
 * Mark pending suggestions as superseded (out of date), so they leave the review list.
 *
 * @param input.changeEventIds - The pending events.
 * @param input.resolvedAt - When.
 * @returns How many were marked.
 */
export async function markChangeEventsSuperseded({
    changeEventIds,
    resolvedAt,
}: {
    changeEventIds: string[]
    resolvedAt: Date
}) {
    if (changeEventIds.length === 0) {
        return 0
    }
    const { count } = await db().changeEvent.updateMany({
        where: { id: { in: changeEventIds }, status: 'pending' },
        data: { status: 'superseded', resolved_at: resolvedAt },
    })
    return count
}

/**
 * Whether a field of a record has ever been changed (by anyone, in any status).
 *
 * @param input.entityType - `funder` or `opportunity`.
 * @param input.entityId - The record.
 * @param input.field - The field.
 * @returns True when a change event exists.
 */
export async function hasFieldChangeEvents({
    entityType,
    entityId,
    field,
}: {
    entityType: ChangeEntityType
    entityId: string
    field: string
}) {
    return (await db().changeEvent.count({ where: { entity_type: entityType, entity_id: entityId, field } })) > 0
}
