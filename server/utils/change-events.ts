import type { Prisma } from '#server/generated/prisma/client.ts'
import type { ChangeEventDraft } from '#server/database/change-events.ts'
import { findChangeEvent, resolveChangeEvent, writeFieldChanges, writeRevert } from '#server/database/change-events.ts'
import { findFunder } from '#server/database/funders.ts'
import { findOpportunity } from '#server/database/opportunities.ts'
import { centsToBigInt, centsToNumber, fromDateOnly, toDateOnly } from '#server/utils/dates.ts'
import { badRequest, conflict, notFound } from '#server/utils/errors.ts'
import type { ChangeSource } from '#shared/constants/pipeline.ts'
import type { ChangeEntityType } from '#shared/schemas/index.ts'
import { funderNameKey } from '#shared/utils/funder-names.ts'

type FieldKind = 'text' | 'date' | 'cents' | 'integer' | 'json'

// Every tracked field and how its value is stored. Change events hold the API form of each value
// (YYYY-MM-DD dates, cents as numbers), so the Activity log reads like the API.
export const TRACKED_FIELDS = {
    funder: {
        name: 'text',
        kind: 'text',
        tier: 'text',
        relationship_status: 'text',
        geo_focus: 'text',
        potential_size: 'text',
        email_domains: 'json',
        materials_sent_at: 'date',
        last_contact_at: 'date',
        last_contact_note: 'text',
        notes: 'text',
        owner_id: 'text',
        status: 'text',
    },
    opportunity: {
        goal_id: 'text',
        name: 'text',
        stage: 'text',
        amount_cents: 'cents',
        probability_override: 'integer',
        expected_decision_at: 'date',
        expected_receipt_at: 'date',
        received_at: 'date',
        next_step: 'text',
        owner_id: 'text',
    },
} as const satisfies Record<ChangeEntityType, Record<string, FieldKind>>

export type TrackedField<Entity extends ChangeEntityType> = keyof (typeof TRACKED_FIELDS)[Entity]

export type ChangeValue = string | number | string[] | null

/**
 * Apply changes to tracked fields of a funder or opportunity and log each one.
 *
 * Fields whose value doesn't actually change are skipped. With `status: 'pending'` nothing is written
 * to the entity; the events wait on the Activity page for someone to accept them.
 *
 * @param input.entityType - `funder` or `opportunity`.
 * @param input.entityId - The record.
 * @param input.changes - Field → new value in API form (YYYY-MM-DD dates, cents as numbers).
 * @param input.source - Where the change came from.
 * @param input.status - `applied` (default) or `pending`.
 * @param input.actorUserId - The user making it, or null for imports and AI.
 * @param input.evidenceId - Email evidence id, if any.
 * @param input.reason - Why it changed.
 * @param input.confidence - AI confidence 0–1, if any.
 * @returns The change events written (empty when nothing changed).
 * @throws ApiError 404 when the entity doesn't exist; 400 for an untracked field.
 */
export async function applyFieldChanges<Entity extends ChangeEntityType>({
    entityType,
    entityId,
    changes,
    source,
    status = 'applied',
    actorUserId = null,
    evidenceId = null,
    reason = null,
    confidence = null,
}: {
    entityType: Entity
    entityId: string
    changes: Partial<Record<TrackedField<Entity>, ChangeValue>>
    source: ChangeSource
    status?: 'applied' | 'pending'
    actorUserId?: string | null
    evidenceId?: string | null
    reason?: string | null
    confidence?: number | null
}) {
    const current = await loadEntityValues({ entityType, entityId })
    const fieldKinds = TRACKED_FIELDS[entityType] as Record<string, FieldKind>
    const drafts: ChangeEventDraft[] = []
    const columnUpdates: Record<string, unknown> = {}

    for (const [field, toValue] of Object.entries(changes) as [string, ChangeValue | undefined][]) {
        const kind = fieldKinds[field]
        if (!kind) {
            throw badRequest({ message: `${field} is not a tracked ${entityType} field.` })
        }
        if (toValue === undefined) {
            continue
        }
        const fromValue = toChangeValue({ kind, value: current[field] })
        if (JSON.stringify(fromValue) === JSON.stringify(toValue)) {
            continue
        }
        drafts.push({ field, fromValue: fromValue as Prisma.InputJsonValue, toValue: toValue as Prisma.InputJsonValue })
        Object.assign(columnUpdates, toColumnUpdates({ entityType, field, kind, value: toValue }))
    }

    if (drafts.length === 0) {
        return []
    }
    return writeFieldChanges({
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
    })
}

/**
 * Accept a pending change: write its value to the entity and mark it applied.
 *
 * @param input.changeEventId - The pending event.
 * @param input.actorUserId - Who accepted it.
 * @returns Resolves once applied.
 * @throws ApiError 404 when missing; 400 when it isn't pending.
 */
export async function acceptChangeEvent({
    changeEventId,
    actorUserId,
}: {
    changeEventId: string
    actorUserId: string
}) {
    const event = await findChangeEvent({ changeEventId })
    if (!event) {
        throw notFound({ resource: 'Change' })
    }
    if (event.status !== 'pending') {
        throw badRequest({ message: 'Only pending changes can be accepted.', code: 'change_not_pending' })
    }
    const entityType = event.entity_type as ChangeEntityType
    const kind = (TRACKED_FIELDS[entityType] as Record<string, FieldKind>)[event.field]!
    const current = await loadEntityValues({ entityType, entityId: event.entity_id })
    await resolveChangeEvent({
        changeEventId,
        status: 'applied',
        resolvedByUserId: actorUserId,
        resolvedAt: new Date(),
        fromValue: toChangeValue({ kind, value: current[event.field] }) as Prisma.InputJsonValue | null,
        entityUpdate: {
            entityType,
            entityId: event.entity_id,
            data: toColumnUpdates({ entityType, field: event.field, kind, value: event.to_value as ChangeValue }),
        },
    })
}

/**
 * Reject a pending change without touching the entity.
 *
 * @param input.changeEventId - The pending event.
 * @param input.actorUserId - Who rejected it.
 * @returns Resolves once marked.
 * @throws ApiError 404 when missing; 400 when it isn't pending.
 */
export async function rejectChangeEvent({
    changeEventId,
    actorUserId,
}: {
    changeEventId: string
    actorUserId: string
}) {
    const event = await findChangeEvent({ changeEventId })
    if (!event) {
        throw notFound({ resource: 'Change' })
    }
    if (event.status !== 'pending') {
        throw badRequest({ message: 'Only pending changes can be rejected.', code: 'change_not_pending' })
    }
    await resolveChangeEvent({
        changeEventId,
        status: 'rejected',
        resolvedByUserId: actorUserId,
        resolvedAt: new Date(),
    })
}

/**
 * Revert an applied change: set the field back to its earlier value (logged as a manual change) and
 * mark the original reverted, all in one transaction.
 *
 * Refuses when the field has changed again since, so a revert never silently undoes a later edit.
 *
 * @param input.changeEventId - The applied event.
 * @param input.actorUserId - Who reverted it.
 * @returns Resolves once reverted.
 * @throws ApiError 404 when missing; 400 when it isn't applied; 409 when the field changed since.
 */
export async function revertChangeEvent({
    changeEventId,
    actorUserId,
}: {
    changeEventId: string
    actorUserId: string
}) {
    const event = await findChangeEvent({ changeEventId })
    if (!event) {
        throw notFound({ resource: 'Change' })
    }
    if (event.status !== 'applied') {
        throw badRequest({ message: 'Only applied changes can be reverted.', code: 'change_not_applied' })
    }
    const entityType = event.entity_type as ChangeEntityType
    const kind = (TRACKED_FIELDS[entityType] as Record<string, FieldKind>)[event.field]!
    const current = await loadEntityValues({ entityType, entityId: event.entity_id })
    const currentValue = toChangeValue({ kind, value: current[event.field] })
    if (JSON.stringify(currentValue) !== JSON.stringify(event.to_value ?? null)) {
        throw conflict({ message: 'This field has changed since; edit it directly instead of reverting.' })
    }
    const restoredValue = (event.from_value ?? null) as ChangeValue
    await writeRevert({
        changeEventId,
        entityType,
        entityId: event.entity_id,
        columnUpdates: toColumnUpdates({ entityType, field: event.field, kind, value: restoredValue }),
        draft: {
            field: event.field,
            fromValue: currentValue as Prisma.InputJsonValue | null,
            toValue: restoredValue as Prisma.InputJsonValue | null,
        },
        actorUserId,
        resolvedAt: new Date(),
    })
}

/**
 * Load an entity's current column values.
 *
 * @param input.entityType - `funder` or `opportunity`.
 * @param input.entityId - The record.
 * @returns Column → stored value.
 * @throws ApiError 404 when the record doesn't exist.
 */
async function loadEntityValues({ entityType, entityId }: { entityType: ChangeEntityType; entityId: string }) {
    const row =
        entityType === 'funder'
            ? await findFunder({ funderId: entityId })
            : await findOpportunity({ opportunityId: entityId })
    if (!row) {
        throw notFound({ resource: entityType === 'funder' ? 'Funder' : 'Opportunity' })
    }
    return row as unknown as Record<string, unknown>
}

/**
 * Stored column value → change-log value.
 *
 * @param input.kind - Field kind.
 * @param input.value - Stored value.
 * @returns The API form of the value.
 */
function toChangeValue({ kind, value }: { kind: FieldKind; value: unknown }): ChangeValue {
    if (value === null || value === undefined) {
        return null
    }
    if (kind === 'date') {
        return toDateOnly({ date: value as Date })
    }
    if (kind === 'cents') {
        return centsToNumber({ cents: value as bigint })
    }
    return value as ChangeValue
}

/**
 * Change-log value → columns to write. A funder's name also refreshes its de-duplication key.
 *
 * @param input.entityType - `funder` or `opportunity`.
 * @param input.field - Field name.
 * @param input.kind - Field kind.
 * @param input.value - API form of the value.
 * @returns Column → stored value.
 */
function toColumnUpdates({
    entityType,
    field,
    kind,
    value,
}: {
    entityType: ChangeEntityType
    field: string
    kind: FieldKind
    value: ChangeValue
}) {
    const stored =
        kind === 'date'
            ? fromDateOnly({ value: value as string | null })
            : kind === 'cents'
              ? centsToBigInt({ cents: value as number | null })
              : value
    const updates: Record<string, unknown> = { [field]: stored }
    if (entityType === 'funder' && field === 'name' && typeof value === 'string') {
        updates.name_key = funderNameKey({ name: value })
    }
    return updates
}
