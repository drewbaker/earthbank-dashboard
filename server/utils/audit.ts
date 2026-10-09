import type { Prisma } from '#server/generated/prisma/client.ts'
import { createAuditLogRow } from '#server/database/audit-logs.ts'
import type { AuthActor } from '#server/utils/auth.ts'

/**
 * Record a mutation in the audit log.
 *
 * @param input.actor - Who did it (a user, or the system for jobs and imports).
 * @param input.action - Semantic action, e.g. `funder.created`.
 * @param input.entityType - Kind of record, e.g. `funder`.
 * @param input.entityId - Id of the record.
 * @param input.changes - What changed.
 * @param input.ip - Caller IP, if known.
 * @returns Resolves once the entry is written.
 */
export async function recordAudit({
    actor,
    action,
    entityType,
    entityId,
    changes,
    ip = null,
}: {
    actor: AuthActor
    action: string
    entityType: string
    entityId: string
    changes?: Prisma.InputJsonValue
    ip?: string | null
}) {
    await createAuditLogRow({
        actorUserId: actor.type === 'user' ? actor.userId : null,
        action,
        entityType,
        entityId,
        changes,
        ip,
    })
}
