import type { Prisma } from '#server/generated/prisma/client.ts'
import { db } from '#server/utils/db.ts'
import { newId } from '#server/utils/ids.ts'

/**
 * Whether an email (by Message-ID) has already been processed.
 *
 * @param input.messageIdHeaders - Message-IDs to check.
 * @returns The ones already stored.
 */
export async function findProcessedMessageIds({ messageIdHeaders }: { messageIdHeaders: string[] }) {
    const rows = await db().emailEvidence.findMany({
        where: { message_id_header: { in: messageIdHeaders } },
        select: { message_id_header: true },
    })
    return new Set(rows.map(row => row.message_id_header))
}

/**
 * Store what was learned from an email (never its body).
 *
 * @param input.source - `gmail` or `forward`.
 * @param input.messageIdHeader - RFC Message-ID.
 * @param input.mailboxUserId - Whose mailbox (or who forwarded it).
 * @param input.fromAddress - Sender.
 * @param input.toAddresses - Recipients.
 * @param input.sentAt - When it was sent.
 * @param input.subject - Subject, or null when sensitive.
 * @param input.summary - AI summary of the funding facts.
 * @param input.isRelevant - Whether it was about fundraising.
 * @param input.isSensitive - Whether it was mainly personal/sensitive.
 * @param input.funderId - The matched funder.
 * @param input.model - AI model that read it.
 * @param input.confidence - Overall AI confidence.
 * @returns The evidence row.
 */
export function createEmailEvidence({
    source,
    messageIdHeader,
    mailboxUserId,
    fromAddress,
    toAddresses,
    sentAt,
    subject,
    summary,
    isRelevant,
    isSensitive,
    funderId,
    model,
    confidence,
}: {
    source: 'gmail' | 'forward'
    messageIdHeader: string
    mailboxUserId: string | null
    fromAddress: string
    toAddresses: string[]
    sentAt: Date
    subject: string | null
    summary: string
    isRelevant: boolean
    isSensitive: boolean
    funderId: string | null
    model: string | null
    confidence: number | null
}) {
    return db().emailEvidence.create({
        data: {
            id: newId({ kind: 'emailEvidence' }),
            source,
            message_id_header: messageIdHeader,
            mailbox_user_id: mailboxUserId,
            from_address: fromAddress,
            to_addresses: toAddresses as Prisma.InputJsonValue,
            sent_at: sentAt,
            subject,
            summary,
            is_relevant: isRelevant,
            is_sensitive: isSensitive,
            funder_id: funderId,
            model,
            confidence,
        },
    })
}

/**
 * Point evidence at a funder (after a draft funder is created for it).
 *
 * @param input.emailEvidenceId - The evidence.
 * @param input.funderId - The funder.
 * @returns The updated row.
 */
export function linkEmailEvidenceToFunder({
    emailEvidenceId,
    funderId,
}: {
    emailEvidenceId: string
    funderId: string
}) {
    return db().emailEvidence.update({ where: { id: emailEvidenceId }, data: { funder_id: funderId } })
}

/**
 * A funder's emails, newest first.
 *
 * @param input.funderId - The funder.
 * @param input.limit - How many.
 * @returns Evidence rows with the mailbox owner.
 */
export function listFunderEmailEvidence({ funderId, limit }: { funderId: string; limit: number }) {
    return db().emailEvidence.findMany({
        where: { funder_id: funderId },
        include: { mailbox_user: true },
        orderBy: { sent_at: 'desc' },
        take: limit,
    })
}

/**
 * Evidence rows by id (to show alongside change events).
 *
 * @param input.ids - Evidence ids.
 * @returns Rows with the mailbox owner.
 */
export function findEmailEvidenceByIds({ ids }: { ids: string[] }) {
    return db().emailEvidence.findMany({ where: { id: { in: ids } }, include: { mailbox_user: true } })
}
