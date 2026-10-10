import { z } from 'zod'
import { CHANGE_SOURCES, CHANGE_STATUSES } from '#shared/constants/pipeline.ts'
import { CursorQuery, IsoDateTime, listOf, UserSummary } from '#shared/schemas/common.ts'
import { EmailEvidence } from '#shared/schemas/mail.ts'

export const ChangeEntityType = z.enum(['funder', 'opportunity'])
export type ChangeEntityType = z.infer<typeof ChangeEntityType>

export const ChangeEvent = z.object({
    id: z.string(),
    entity_type: ChangeEntityType,
    entity_id: z.string(),
    entity_name: z.string().nullable(),
    funder_id: z.string().nullable(),
    field: z.string(),
    from_value: z.unknown(),
    to_value: z.unknown(),
    source: z.enum(CHANGE_SOURCES),
    status: z.enum(CHANGE_STATUSES),
    actor: UserSummary.nullable(),
    evidence_id: z.string().nullable(),
    evidence: EmailEvidence.nullable(),
    reason: z.string().nullable(),
    confidence: z.number().nullable(),
    resolved_at: IsoDateTime.nullable(),
    resolved_by: UserSummary.nullable(),
    created_at: IsoDateTime,
})
export type ChangeEvent = z.infer<typeof ChangeEvent>

export const ChangeEventList = listOf(ChangeEvent)
export type ChangeEventList = z.infer<typeof ChangeEventList>

export const ListChangeEventsQuery = CursorQuery.extend({
    entity_type: ChangeEntityType.optional(),
    entity_id: z.string().optional(),
    funder_id: z.string().optional(),
    source: z.enum(CHANGE_SOURCES).optional(),
    /** One status, or several separated by commas (e.g. "applied,pending"). */
    status: z
        .string()
        .transform(value => value.split(',').map(part => part.trim()))
        .pipe(z.array(z.enum(CHANGE_STATUSES)).min(1))
        .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
})
