import type { ChangeEventRow } from '#server/database/change-events.ts'
import { listChangeEventRows } from '#server/database/change-events.ts'
import { findEmailEvidenceByIds } from '#server/database/email-evidence.ts'
import { findFunderNames } from '#server/database/funders.ts'
import type { EmailEvidence as EmailEvidenceRow, User as UserRow } from '#server/generated/prisma/client.ts'
import { findOpportunityNames, listOpportunityIdsForFunder } from '#server/database/opportunities.ts'
import { toIsoDateTime } from '#server/utils/dates.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import { serializeEmailEvidence } from '#server/utils/serializers/email-evidence.ts'
import type { ChangeSource, ChangeStatus } from '#shared/constants/pipeline.ts'
import type { ChangeEntityType, ChangeEvent } from '#shared/schemas/index.ts'

/**
 * A page of change events with the names of what changed, newest first.
 *
 * @param input.entityType - Only this entity type.
 * @param input.entityId - Only this entity.
 * @param input.funderId - A funder and all of its opportunities.
 * @param input.source - Only this source.
 * @param input.status - Only this status.
 * @param input.cursor - Continue after this event id.
 * @param input.limit - Page size.
 * @param input.viewer - The signed-in person; only emails from their own inbox get an "Open in Gmail" link.
 * @returns `{ data, next_cursor, has_more }`.
 */
export async function listChangeEventFeed({
    entityType,
    entityId,
    funderId,
    source,
    status,
    cursor,
    limit,
    viewer,
}: {
    entityType?: ChangeEntityType
    entityId?: string
    funderId?: string
    source?: ChangeSource
    status?: ChangeStatus
    cursor?: string
    limit: number
    viewer?: { id: string; email: string }
}) {
    let entityIds = entityId ? [entityId] : undefined
    if (funderId) {
        entityIds = [funderId, ...(await listOpportunityIdsForFunder({ funderId }))]
    }
    const rows = await listChangeEventRows({ entityType, entityIds, source, status, cursor, limit })
    const page = rows.slice(0, limit)
    const [names, evidence] = await Promise.all([loadEntityNames({ events: page }), loadEvidence({ events: page })])
    return {
        data: page.map(event =>
            serializeChangeEvent({
                event,
                ...names.get(event.entity_id),
                evidence: event.evidence_id ? (evidence.get(event.evidence_id) ?? null) : null,
                viewer,
            }),
        ),
        next_cursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
        has_more: rows.length > limit,
    }
}

/**
 * Public shape of a change event.
 *
 * @param input.event - The event row with its users.
 * @param input.entityName - Display name of the funder or opportunity.
 * @param input.funderId - The funder it belongs to.
 * @param input.evidence - The email behind an AI change, if any.
 * @param input.viewer - The signed-in person, for the evidence's Gmail link.
 * @returns The API representation.
 */
export function serializeChangeEvent({
    event,
    entityName = null,
    funderId = null,
    evidence = null,
    viewer,
}: {
    event: ChangeEventRow
    entityName?: string | null
    funderId?: string | null
    evidence?: (EmailEvidenceRow & { mailbox_user: UserRow | null }) | null
    viewer?: { id: string; email: string }
}): ChangeEvent {
    return {
        id: event.id,
        entity_type: event.entity_type as ChangeEntityType,
        entity_id: event.entity_id,
        entity_name: entityName,
        funder_id: funderId,
        field: event.field,
        from_value: event.from_value,
        to_value: event.to_value,
        source: event.source as ChangeSource,
        status: event.status as ChangeStatus,
        actor: serializeUserSummary({ user: event.actor_user }),
        evidence_id: event.evidence_id,
        evidence: evidence ? serializeEmailEvidence({ evidence, viewer }) : null,
        reason: event.reason,
        confidence: event.confidence,
        resolved_at: toIsoDateTime({ date: event.resolved_at }),
        resolved_by: serializeUserSummary({ user: event.resolved_by_user }),
        created_at: event.created_at.toISOString(),
    }
}

/**
 * Look up display names for the funders and opportunities a page of events refers to.
 *
 * @param input.events - The events.
 * @returns Entity id → `{ entityName, funderId }`.
 */
async function loadEntityNames({ events }: { events: ChangeEventRow[] }) {
    const funderIds = events.filter(event => event.entity_type === 'funder').map(event => event.entity_id)
    const opportunityIds = events.filter(event => event.entity_type === 'opportunity').map(event => event.entity_id)
    const [funders, opportunities] = await Promise.all([
        findFunderNames({ funderIds }),
        findOpportunityNames({ opportunityIds }),
    ])
    const names = new Map<string, { entityName: string; funderId: string }>()
    for (const funder of funders) {
        names.set(funder.id, { entityName: funder.name, funderId: funder.id })
    }
    for (const opportunity of opportunities) {
        names.set(opportunity.id, {
            entityName: `${opportunity.funder.name} · ${opportunity.name}`,
            funderId: opportunity.funder.id,
        })
    }
    return names
}

/**
 * Load the emails behind a page of AI changes.
 *
 * @param input.events - The events.
 * @returns Evidence id → evidence row.
 */
async function loadEvidence({ events }: { events: ChangeEventRow[] }) {
    const ids = [...new Set(events.flatMap(event => (event.evidence_id ? [event.evidence_id] : [])))]
    const rows = ids.length ? await findEmailEvidenceByIds({ ids }) : []
    return new Map(rows.map(row => [row.id, row]))
}
