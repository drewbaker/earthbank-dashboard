import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Append one audit log entry.
 *
 * @param input.actorUserId - The user who acted, or null for the system.
 * @param input.action - Semantic action, e.g. `user.deactivated`.
 * @param input.entityType - Kind of record, e.g. `user`.
 * @param input.entityId - Id of the record.
 * @param input.changes - What changed, as JSON.
 * @param input.ip - Caller IP, if known.
 * @returns The audit log row.
 */
export function createAuditLogRow({
    actorUserId,
    action,
    entityType,
    entityId,
    changes,
    ip,
}: {
    actorUserId: string | null
    action: string
    entityType: string
    entityId: string
    changes: Prisma.InputJsonValue | undefined
    ip: string | null
}) {
    return db().auditLog.create({
        data: {
            id: newId({ kind: 'auditLog' }),
            actor_user_id: actorUserId,
            action,
            entity_type: entityType,
            entity_id: entityId,
            changes,
            ip,
        },
    })
}
