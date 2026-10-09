import type { EmailEvidence as EmailEvidenceRow, User as UserRow } from '#server/generated/prisma/client.ts'
import { serializeUserSummary } from '#server/utils/serializers/common.ts'
import type { EmailEvidence } from '#shared/schemas/index.ts'

/**
 * Public shape of what was kept about an email. Recipients and Message-IDs stay internal.
 *
 * @param input.evidence - The evidence row with its mailbox owner.
 * @returns The API representation.
 */
export function serializeEmailEvidence({
    evidence,
}: {
    evidence: EmailEvidenceRow & { mailbox_user: UserRow | null }
}): EmailEvidence {
    return {
        id: evidence.id,
        source: evidence.source === 'forward' ? 'forward' : 'gmail',
        from_address: evidence.from_address,
        sent_at: evidence.sent_at.toISOString(),
        subject: evidence.is_sensitive ? null : evidence.subject,
        summary: evidence.summary,
        is_relevant: evidence.is_relevant,
        is_sensitive: evidence.is_sensitive,
        funder_id: evidence.funder_id,
        mailbox_user: serializeUserSummary({ user: evidence.mailbox_user }),
    }
}
